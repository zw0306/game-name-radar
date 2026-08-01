import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateNameRisk, cleanGameName } from '../lib/seo-verifier.mjs';
import { classifySiteType } from '../lib/site-type.mjs';
import { calculateFastSignals } from '../lib/fast-signals.mjs';
import { SEO_MODEL_VERSION } from '../lib/trend-queue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const reportPath = path.join(root, 'data', 'latest-report.json');
const LIMIT = Math.max(0, Number(process.env.SEO_EVIDENCE_FALLBACK_LIMIT || 300));
const DAY = 86400000;

const ONLINE_STRATEGIC = new Set([
  'crazygames-new', 'poki-new', 'y8-new', 'gamepix-new', 'lagged-new',
  'newgrounds-daily-top', 'newgrounds-latest',
  'itch-new-popular-web', 'itch-featured-feed', 'itch-newest-web',
  'newgrounds-top', 'newgrounds-new', 'itch-popular',
]);
const WIKI_STRATEGIC = new Set([
  'steam-popular-new', 'steam-latest-indie',
  'itch-featured-feed', 'itch-new-popular-web',
  'newgrounds-daily-top', 'competitor-sitemap',
  'steam-new', 'itch-featured', 'itch-popular', 'newgrounds-top',
]);

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}

function kindsOf(candidate) {
  return new Set((candidate.sources || [])
    .flatMap((source) => [source.kind, source.sourceId, source.id])
    .filter(Boolean));
}

function sourceCount(candidate) {
  return new Set((candidate.sources || [])
    .map((source) => source.sourceId || source.kind || source.id || source.url)
    .filter(Boolean)).size;
}

function hasUsableSeo(candidate) {
  const seo = candidate.seo;
  if (!seo || seo.modelVersion !== SEO_MODEL_VERSION) return false;
  return !['pending', 'error'].includes(seo.classification);
}

function strategicCountFor(kinds, channel) {
  const strategic = channel === 'online' ? ONLINE_STRATEGIC : WIKI_STRATEGIC;
  return [...kinds].filter((kind) => strategic.has(kind)).length;
}

function evidenceScore(candidate, channel) {
  const kinds = kindsOf(candidate);
  const strategicCount = strategicCountFor(kinds, channel);
  const sources = sourceCount(candidate);
  const fastScore = Number(candidate.fast?.score || 0);
  const discovery = Number(candidate.discoveryScore || 0);
  const platforms = Number(candidate.siteType?.onlinePlatformCount || candidate.fast?.onlinePlatformCount || 0);
  const age = Date.now() - Date.parse(candidate.firstSeen || 0);
  const recentBoost = Number.isFinite(age) && age <= 3 * DAY ? 8 : 0;
  return fastScore + discovery * 2 + strategicCount * 14 + sources * 7 + platforms * 18 + recentBoost;
}

function buildFallback(candidate) {
  candidate.siteType = classifySiteType(candidate);
  const channel = candidate.siteType.type;
  if (!['online', 'wiki'].includes(channel)) return null;

  const name = cleanGameName(candidate.gameName || '');
  const nameRisk = estimateNameRisk(name);
  const kinds = kindsOf(candidate);
  const sources = sourceCount(candidate);
  const fastClass = candidate.fast?.classification || 'pending';
  const fastScore = Number(candidate.fast?.score || 0);
  const discovery = Number(candidate.discoveryScore || 0);
  const platforms = Number(candidate.siteType?.onlinePlatformCount || candidate.fast?.onlinePlatformCount || 0);
  const strategicCount = strategicCountFor(kinds, channel);
  const browserEvidence = Boolean(candidate.siteType?.browserPlayable)
    || platforms >= 1
    || [...kinds].some((kind) => ONLINE_STRATEGIC.has(kind));

  let qualifies = false;
  const reasons = [];

  if (channel === 'online') {
    // Do not require fastClass here. Fast signals previously depended on SEO,
    // which created a deadlock when Serper had no quota. Strong independent
    // platform evidence is enough for a provisional SEO record.
    qualifies = browserEvidence
      && nameRisk <= 20
      && (
        (platforms >= 2 && strategicCount >= 2 && discovery >= 10)
        || (platforms >= 2 && sources >= 2 && discovery >= 12)
        || (strategicCount >= 2 && sources >= 2 && discovery >= 12)
        || (strategicCount >= 1 && sources >= 3 && discovery >= 16)
        || (fastClass === 'pass' && strategicCount >= 1 && fastScore >= 24)
      );

    if (platforms >= 2) reasons.push(`已在${platforms}个在线游戏平台发现`);
    else if (strategicCount >= 1) reasons.push(`来自${strategicCount}个浏览器游戏平台战略来源`);
    if (browserEvidence) reasons.push('存在浏览器可玩或在线游戏平台证据');
  } else {
    const hasSteamEvidence = kinds.has('steam-popular-new')
      || kinds.has('steam-latest-indie')
      || kinds.has('steam-new');

    qualifies = nameRisk <= 18
      && (
        (hasSteamEvidence && sources >= 1 && discovery >= 10)
        || (strategicCount >= 2 && sources >= 2 && discovery >= 10)
        || (strategicCount >= 1 && sources >= 3 && discovery >= 15)
        || (fastClass === 'pass' && strategicCount >= 1 && fastScore >= 24)
      );

    if (hasSteamEvidence) reasons.push('存在Steam发行或热门新游证据');
    if (strategicCount >= 2) reasons.push('多个Wiki战略来源同时出现');
  }

  if (!qualifies) return null;
  if (sources >= 2) reasons.push(`共有${sources}个独立发现来源`);
  reasons.push('Serper额度不足，当前为平台证据临时验证，仍需后续SERP复核');

  const rawScore = channel === 'online'
    ? 28 + platforms * 10 + strategicCount * 6 + Math.min(12, sources * 3) + Math.min(10, Math.round(discovery / 2))
    : 28 + strategicCount * 8 + Math.min(12, sources * 3) + Math.min(10, Math.round(discovery / 2));

  return {
    modelVersion: SEO_MODEL_VERSION,
    checkedAt: new Date().toISOString(),
    status: 'provisional',
    provider: 'evidence-fallback',
    queryName: name,
    classification: 'page',
    score: Math.max(35, Math.min(62, rawScore - Math.round(nameRisk * 0.5))),
    nameRisk,
    entityConflict: false,
    provisional: true,
    confidence: 'medium',
    sourceCount: sources,
    strategicSourceCount: strategicCount,
    onlinePlatformCount: platforms,
    discoveryScore: discovery,
    reasons,
  };
}

const payload = await readJson(candidatesPath, { candidates: [] });
const candidates = Array.isArray(payload) ? payload : payload.candidates || [];
const report = await readJson(reportPath, {});

const queue = candidates
  .filter((candidate) => !hasUsableSeo(candidate))
  .map((candidate) => {
    candidate.siteType = classifySiteType(candidate);
    return { candidate, priority: evidenceScore(candidate, candidate.siteType.type) };
  })
  .sort((a, b) => b.priority - a.priority)
  .slice(0, LIMIT);

let verified = 0;
const verifiedNames = [];
const channelVerified = { online: 0, wiki: 0, pending: 0 };
const fastRecalculated = { pass: 0, watch: 0, weak: 0, reject: 0, pending: 0 };

for (const item of queue) {
  const verdict = buildFallback(item.candidate);
  if (!verdict) continue;
  item.candidate.seo = verdict;
  item.candidate.fast = calculateFastSignals(item.candidate, item.candidate.fast || {});
  fastRecalculated[item.candidate.fast?.classification || 'pending'] += 1;
  item.candidate.recommendation = item.candidate.trend ? item.candidate.recommendation || 'watch' : 'pending';
  item.candidate.level = item.candidate.recommendation;
  verified += 1;
  channelVerified[item.candidate.siteType.type] += 1;
  verifiedNames.push(item.candidate.gameName);
}

await fs.writeFile(candidatesPath, JSON.stringify({ ...payload, candidates }, null, 2) + '\n');
await fs.writeFile(reportPath, JSON.stringify({
  ...report,
  evidenceSeoFallback: {
    enabled: true,
    limit: LIMIT,
    queueSize: queue.length,
    verified,
    channelVerified,
    fastRecalculated,
    verifiedNames: verifiedNames.slice(0, 100),
    ranAt: new Date().toISOString(),
  },
}, null, 2) + '\n');

console.log(`Evidence SEO fallback complete: ${verified} provisional page candidate(s); fast signals recalculated.`);
