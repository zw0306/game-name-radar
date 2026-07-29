import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTrendDemand, getSerpApiUsage } from '../lib/trend-verifier.mjs';
import { buildTieredTrendQueue, TREND_MODEL_VERSION } from '../lib/trend-queue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const reportPath = path.join(root, 'data', 'latest-report.json');
const enabled = String(process.env.SERPAPI_FILL_ENABLED || 'true').toLowerCase() !== 'false';
const caps = {
  strong: Math.max(0, Number(process.env.SERPAPI_TIER1_LIMIT || 3)),
  secondary: Math.max(0, Number(process.env.SERPAPI_TIER2_LIMIT || 3)),
  strategic: Math.max(0, Number(process.env.SERPAPI_TIER3_LIMIT || 2)),
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

function applyFinalRecommendation(candidate) {
  const seoClass = candidate.seo?.classification || 'pending';
  const fastClass = candidate.fast?.classification || 'pending';
  const demandClass = candidate.trend?.classification || 'pending';
  const globalDemandClass = candidate.trend?.globalClassification || null;
  const globalRising = ['rising', 'breakout'].includes(globalDemandClass);
  const nameRisk = Number(candidate.seo?.nameRisk ?? 30);
  const keywordFreshness = candidate.trend?.keywordFreshness || 'unknown';
  const entityConflict = Boolean(candidate.seo?.entityConflict || candidate.trend?.entityConflict);
  let recommendation = 'pending';

  if (candidate.seo?.modelVersion !== 5) recommendation = 'pending';
  else if (seoClass === 'error') recommendation = 'error';
  else if (seoClass === 'reject' || candidate.seo?.entityConflict || fastClass === 'reject') recommendation = 'reject';
  else if (seoClass === 'pending' || fastClass === 'pending') recommendation = 'pending';
  else if (fastClass === 'weak') recommendation = 'reject';
  else if (fastClass === 'watch') recommendation = 'watch';
  else if (demandClass === 'error' || demandClass === 'pending') recommendation = 'pending';
  else if (
    seoClass === 'independent' &&
    nameRisk <= 12 &&
    keywordFreshness !== 'existing' &&
    !entityConflict &&
    ['rising', 'breakout'].includes(demandClass)
  ) recommendation = 'independent';
  else if (globalRising && ['moderate', 'strong'].includes(demandClass) && ['independent', 'page'].includes(seoClass)) recommendation = 'page';
  else if (globalRising) recommendation = 'watch';
  else if (demandClass === 'none') recommendation = 'reject';
  else if (demandClass === 'weak') recommendation = 'watch';
  else if (['independent', 'page'].includes(seoClass) && ['strong', 'moderate'].includes(demandClass)) recommendation = 'page';
  else recommendation = 'watch';

  const seoScore = Number(candidate.seo?.score || 0);
  const fastScore = Number(candidate.fast?.score || 0);
  const trendScore = Number(candidate.trend?.score || 0);
  const globalScore = Number(candidate.trend?.globalScore || 0);
  let finalScore = Math.round(seoScore * 0.32 + fastScore * 0.28 + trendScore * 0.34 + globalScore * 0.06);
  if (['rising', 'breakout'].includes(demandClass)) finalScore = Math.min(100, finalScore + 8);
  else if (globalRising) finalScore = Math.min(79, finalScore + 4);
  if (keywordFreshness === 'existing' || entityConflict) finalScore = Math.min(finalScore, 69);
  if (recommendation === 'watch') finalScore = Math.min(finalScore, 59);
  if (['reject', 'pending', 'error'].includes(recommendation)) finalScore = 0;

  candidate.finalScore = finalScore;
  candidate.score = finalScore;
  candidate.level = recommendation;
  candidate.recommendation = recommendation;
}

function recommendationCounts(candidates) {
  const counts = { independent: 0, page: 0, watch: 0, reject: 0, pending: 0, error: 0 };
  for (const candidate of candidates) counts[candidate.recommendation || 'pending'] = (counts[candidate.recommendation || 'pending'] || 0) + 1;
  return counts;
}

const payload = await readJson(candidatesPath, { candidates: [] });
const candidates = Array.isArray(payload) ? payload : payload.candidates || [];
const report = await readJson(reportPath, {});
let usage = await getSerpApiUsage();
const remainingAtStart = Math.max(0, Math.min(
  Number(usage.dailyLimit || 0) - Number(usage.dayUsed || 0),
  Number(usage.monthlyLimit || 0) - Number(usage.monthUsed || 0),
));
const queue = enabled && usage.enabled && remainingAtStart > 0 ? buildTieredTrendQueue(candidates, caps) : [];

let verified = 0;
let errors = 0;
let quotaStopped = false;
const tierCounts = { strong: 0, secondary: 0, strategic: 0 };
const verifiedNames = [];

for (const item of queue) {
  usage = await getSerpApiUsage();
  const remaining = Math.max(0, Math.min(
    Number(usage.dailyLimit || 0) - Number(usage.dayUsed || 0),
    Number(usage.monthlyLimit || 0) - Number(usage.monthUsed || 0),
  ));
  if (remaining <= 0) { quotaStopped = true; break; }

  const candidate = item.candidate;
  const previousTrend = candidate.trend;
  try {
    console.log(`SerpApi quota fill [${item.tier}]: ${candidate.gameName}`);
    candidate.trend = {
      ...await verifyTrendDemand(candidate.gameName),
      modelVersion: TREND_MODEL_VERSION,
      validationTier: item.tier,
      validationReason: item.reason,
    };
    verified += 1;
    tierCounts[item.tier] += 1;
    verifiedNames.push(candidate.gameName);
  } catch (error) {
    if (error.code === 'SERPAPI_QUOTA_GUARD' || /safety limit reached/i.test(error.message)) {
      quotaStopped = true;
      break;
    }
    const previousIsValid = previousTrend && !['error', 'pending'].includes(previousTrend.classification);
    candidate.trend = previousIsValid
      ? { ...previousTrend, stale: true, lastError: error.message, lastErrorAt: new Date().toISOString() }
      : {
          modelVersion: TREND_MODEL_VERSION,
          checkedAt: new Date().toISOString(),
          status: 'error',
          classification: 'error',
          score: 0,
          validationTier: item.tier,
          reasons: [`SerpApi补充验证失败：${error.message}`],
        };
    errors += 1;
  }
  applyFinalRecommendation(candidate);
  await sleep(1000);
}

for (const candidate of candidates) applyFinalRecommendation(candidate);
usage = await getSerpApiUsage();

const trendValidatedCount = candidates.filter((candidate) =>
  candidate.trend?.modelVersion === TREND_MODEL_VERSION && !['pending', 'error'].includes(candidate.trend?.classification)
).length;
const risingCount = candidates.filter((candidate) => ['rising', 'breakout'].includes(candidate.trend?.classification)).length;
const globalRisingCount = candidates.filter((candidate) => ['rising', 'breakout'].includes(candidate.trend?.globalClassification)).length;
const pendingByTier = { strong: 0, secondary: 0, strategic: 0 };
for (const item of buildTieredTrendQueue(candidates, { strong: 9999, secondary: 9999, strategic: 9999 })) pendingByTier[item.tier] += 1;

await fs.writeFile(candidatesPath, JSON.stringify({ ...payload, candidates }, null, 2) + '\n');
await fs.writeFile(reportPath, JSON.stringify({
  ...report,
  trendsVerified: Number(report.trendsVerified || 0) + verified,
  trendErrors: Number(report.trendErrors || 0) + errors,
  trendValidatedCount,
  risingCount,
  globalRisingCount,
  recommendationCounts: recommendationCounts(candidates),
  serpApiUsage: usage,
  serpApiQuotaFill: {
    enabled,
    remainingAtStart,
    queueSize: queue.length,
    verified,
    errors,
    quotaStopped,
    tierCounts,
    pendingByTier,
    verifiedNames,
    caps,
    ranAt: new Date().toISOString(),
  },
}, null, 2) + '\n');

console.log(`SerpApi quota fill complete: ${verified} verified, ${errors} errors, daily usage ${usage.dayUsed || 0}/${usage.dailyLimit || 0}.`);
