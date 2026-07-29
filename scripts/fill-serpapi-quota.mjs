import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTrendDemand, getSerpApiUsage, TREND_PROFILE_VERSION } from '../lib/trend-verifier.mjs';
import { buildBalancedTrendQueue, TREND_MODEL_VERSION } from '../lib/trend-queue.mjs';
import { classifySiteType } from '../lib/site-type.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const reportPath = path.join(root, 'data', 'latest-report.json');
const enabled = String(process.env.SERPAPI_FILL_ENABLED || 'true').toLowerCase() !== 'false';
const caps = {
  online: Math.max(0, Number(process.env.SERPAPI_ONLINE_LIMIT || 5)),
  wiki: Math.max(0, Number(process.env.SERPAPI_WIKI_LIMIT || 2)),
  flexible: Math.max(0, Number(process.env.SERPAPI_FLEX_LIMIT || 1)),
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } }

function typeOf(candidate) {
  if (candidate.siteType?.modelVersion === 2) return candidate.siteType.type;
  candidate.siteType = classifySiteType(candidate);
  return candidate.siteType.type;
}

function applyFinalRecommendation(candidate) {
  const seoClass = candidate.seo?.classification || 'pending';
  const fastClass = candidate.fast?.classification || 'pending';
  const demandClass = candidate.trend?.classification || 'pending';
  const globalDemandClass = candidate.trend?.globalClassification || null;
  const globalRising = ['rising', 'breakout'].includes(globalDemandClass);
  const usRising = ['rising', 'breakout'].includes(demandClass);
  const nameRisk = Number(candidate.seo?.nameRisk ?? 30);
  const keywordFreshness = candidate.trend?.keywordFreshness || 'unknown';
  const entityConflict = Boolean(candidate.seo?.entityConflict || candidate.trend?.entityConflict);
  const channel = typeOf(candidate);
  const onlinePlatforms = Number(candidate.siteType?.onlinePlatformCount || candidate.fast?.onlinePlatformCount || 0);
  let recommendation = 'pending';

  if (candidate.seo?.modelVersion !== 5) recommendation = 'pending';
  else if (seoClass === 'error') recommendation = 'error';
  else if (seoClass === 'reject' || entityConflict || fastClass === 'reject') recommendation = 'reject';
  else if (seoClass === 'pending' || fastClass === 'pending') recommendation = 'pending';
  else if (usRising && channel === 'online' && ['independent', 'page'].includes(seoClass) && nameRisk <= 18 && keywordFreshness !== 'existing' && candidate.siteType?.browserPlayable) {
    recommendation = fastClass === 'pass' || onlinePlatforms >= 2 ? 'independent' : 'watch';
  }
  else if (usRising && channel === 'wiki' && seoClass === 'independent' && fastClass === 'pass' && nameRisk <= 12 && keywordFreshness !== 'existing') recommendation = 'independent';
  else if (usRising && ['independent', 'page'].includes(seoClass)) recommendation = 'watch';
  else if (globalRising && ['moderate', 'strong'].includes(demandClass) && ['independent', 'page'].includes(seoClass)) recommendation = 'page';
  else if (globalRising) recommendation = 'watch';
  else if (demandClass === 'error' || demandClass === 'pending') recommendation = fastClass === 'watch' ? 'watch' : 'pending';
  else if (demandClass === 'none') recommendation = fastClass === 'weak' ? 'reject' : 'watch';
  else if (demandClass === 'weak') recommendation = 'watch';
  else if (['independent', 'page'].includes(seoClass) && ['strong', 'moderate'].includes(demandClass)) recommendation = 'page';
  else if (fastClass === 'weak') recommendation = 'reject';
  else recommendation = 'watch';

  const seoScore = Number(candidate.seo?.score || 0), fastScore = Number(candidate.fast?.score || 0), trendScore = Number(candidate.trend?.score || 0), globalScore = Number(candidate.trend?.globalScore || 0);
  const weights = channel === 'online' ? { seo: 0.28, fast: 0.34, trend: 0.34, global: 0.04 } : { seo: 0.32, fast: 0.28, trend: 0.34, global: 0.06 };
  let finalScore = Math.round(seoScore * weights.seo + fastScore * weights.fast + trendScore * weights.trend + globalScore * weights.global);
  if (usRising) finalScore = Math.min(100, finalScore + 8);
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

function channelCounts(candidates) {
  const counts = { online: { validated: 0, rising: 0, recommended: 0 }, wiki: { validated: 0, rising: 0, recommended: 0 }, pending: { validated: 0, rising: 0, recommended: 0 } };
  for (const candidate of candidates) {
    const channel = typeOf(candidate);
    if (candidate.trend?.modelVersion === TREND_MODEL_VERSION && !['pending', 'error'].includes(candidate.trend?.classification)) counts[channel].validated += 1;
    if (['rising', 'breakout'].includes(candidate.trend?.classification)) counts[channel].rising += 1;
    if (candidate.recommendation === 'independent') counts[channel].recommended += 1;
  }
  return counts;
}

const payload = await readJson(candidatesPath, { candidates: [] });
const candidates = Array.isArray(payload) ? payload : payload.candidates || [];
for (const candidate of candidates) candidate.siteType = classifySiteType(candidate);
const report = await readJson(reportPath, {});
let usage = await getSerpApiUsage();
const remainingAtStart = Math.max(0, Math.min(Number(usage.dailyLimit || 0) - Number(usage.dayUsed || 0), Number(usage.monthlyLimit || 0) - Number(usage.monthUsed || 0)));
const queue = enabled && usage.enabled && remainingAtStart > 0 ? buildBalancedTrendQueue(candidates, caps) : [];

let verified = 0, errors = 0, quotaStopped = false;
const tierCounts = { strong: 0, secondary: 0, strategic: 0 };
const channelVerified = { online: 0, wiki: 0, pending: 0 };
const verifiedNames = [];

for (const item of queue) {
  usage = await getSerpApiUsage();
  const remaining = Math.max(0, Math.min(Number(usage.dailyLimit || 0) - Number(usage.dayUsed || 0), Number(usage.monthlyLimit || 0) - Number(usage.monthUsed || 0)));
  if (remaining <= 0) { quotaStopped = true; break; }
  const candidate = item.candidate;
  const previousTrend = candidate.trend;
  try {
    console.log(`SerpApi typed fill [${item.channel}/${item.tier}]: ${candidate.gameName}`);
    candidate.trend = {
      ...await verifyTrendDemand(candidate.gameName, { siteType: item.channel, allowGlobal: false }),
      modelVersion: TREND_MODEL_VERSION,
      profileVersion: TREND_PROFILE_VERSION,
      validationTier: item.tier,
      validationChannel: item.channel,
      validationReason: item.reason,
    };
    verified += 1;
    tierCounts[item.tier] += 1;
    channelVerified[item.channel] += 1;
    verifiedNames.push(candidate.gameName);
  } catch (error) {
    if (error.code === 'SERPAPI_QUOTA_GUARD' || /safety limit reached/i.test(error.message)) { quotaStopped = true; break; }
    const previousIsValid = previousTrend && !['error', 'pending'].includes(previousTrend.classification);
    candidate.trend = previousIsValid ? { ...previousTrend, stale: true, lastError: error.message, lastErrorAt: new Date().toISOString() } : { modelVersion: TREND_MODEL_VERSION, profileVersion: TREND_PROFILE_VERSION, checkedAt: new Date().toISOString(), status: 'error', classification: 'error', score: 0, validationTier: item.tier, validationChannel: item.channel, reasons: [`SerpApi分类验证失败：${error.message}`] };
    errors += 1;
  }
  applyFinalRecommendation(candidate);
  await sleep(800);
}

for (const candidate of candidates) applyFinalRecommendation(candidate);
usage = await getSerpApiUsage();
const trendValidatedCount = candidates.filter((candidate) => candidate.trend?.modelVersion === TREND_MODEL_VERSION && !['pending', 'error'].includes(candidate.trend?.classification)).length;
const risingCount = candidates.filter((candidate) => ['rising', 'breakout'].includes(candidate.trend?.classification)).length;
const globalRisingCount = candidates.filter((candidate) => ['rising', 'breakout'].includes(candidate.trend?.globalClassification)).length;
const allPending = buildBalancedTrendQueue(candidates, { online: 9999, wiki: 9999, flexible: 0 });
const pendingByChannel = { online: allPending.filter((item) => item.channel === 'online').length, wiki: allPending.filter((item) => item.channel === 'wiki').length };
const pendingByTier = { strong: 0, secondary: 0, strategic: 0 };
for (const item of allPending) pendingByTier[item.tier] += 1;

await fs.writeFile(candidatesPath, JSON.stringify({ ...payload, candidates }, null, 2) + '\n');
await fs.writeFile(reportPath, JSON.stringify({
  ...report,
  trendsVerified: Number(report.trendsVerified || 0) + verified,
  trendErrors: Number(report.trendErrors || 0) + errors,
  trendValidatedCount,
  risingCount,
  globalRisingCount,
  recommendationCounts: recommendationCounts(candidates),
  channelOpportunityCounts: channelCounts(candidates),
  serpApiUsage: usage,
  serpApiQuotaFill: { enabled, remainingAtStart, queueSize: queue.length, verified, errors, quotaStopped, tierCounts, channelVerified, pendingByTier, pendingByChannel, verifiedNames, caps, globalChecks: 0, ranAt: new Date().toISOString() },
}, null, 2) + '\n');
console.log(`SerpApi typed fill complete: ${verified} verified (${channelVerified.online} online, ${channelVerified.wiki} wiki), ${errors} errors, daily usage ${usage.dayUsed || 0}/${usage.dailyLimit || 0}.`);
