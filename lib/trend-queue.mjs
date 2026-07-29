import { FAST_MODEL_VERSION } from './fast-signals.mjs';

export const SEO_MODEL_VERSION = 5;
export const TREND_MODEL_VERSION = 4;

const DAY = 86400000;
const STRATEGIC_KINDS = new Set([
  'trends-rising-7d',
  'trends-rising-30d',
  'itch-featured',
  'itch-popular',
  'steam-popular-new',
  'newgrounds-top',
  'competitor-sitemap',
]);

function sourceKinds(candidate) {
  return new Set((candidate.sources || []).map((source) => source.kind).filter(Boolean));
}

function isTrendDue(candidate, nowMs = Date.now()) {
  const trend = candidate.trend;
  if (!trend || trend.modelVersion !== TREND_MODEL_VERSION) return true;
  const checked = Date.parse(trend.checkedAt || '');
  if (!Number.isFinite(checked)) return true;
  if (trend.status === 'error' || trend.classification === 'error') return nowMs - checked > 3600000;
  return nowMs - checked > DAY;
}

function strategicEvidence(candidate) {
  const kinds = sourceKinds(candidate);
  const strategicKindCount = [...kinds].filter((kind) => STRATEGIC_KINDS.has(kind)).length;
  const sourceCount = new Set((candidate.sources || []).map((source) => source.sourceId || source.kind || source.url)).size;
  const youtubeChannels = Number(candidate.youtube?.channelCount || candidate.fast?.youtubeChannels || 0);
  return {
    kinds,
    strategicKindCount,
    sourceCount,
    youtubeChannels,
    hasStrategicSource: strategicKindCount > 0,
  };
}

export function classifyTrendTier(candidate, nowMs = Date.now()) {
  if (candidate.seo?.modelVersion !== SEO_MODEL_VERSION) return null;
  if (!['independent', 'page'].includes(candidate.seo?.classification)) return null;
  if (candidate.seo?.entityConflict) return null;
  if (candidate.fast?.modelVersion !== FAST_MODEL_VERSION) return null;
  if (!isTrendDue(candidate, nowMs)) return null;

  const seoScore = Number(candidate.seo?.score || 0);
  const nameRisk = Number(candidate.seo?.nameRisk ?? 30);
  const fastClass = candidate.fast?.classification;
  const fastScore = Number(candidate.fast?.score || 0);
  const evidence = strategicEvidence(candidate);
  const age = nowMs - Date.parse(candidate.firstSeen || 0);
  const recent = Number.isFinite(age) && age <= 3 * DAY;

  if (fastClass === 'pass' && seoScore >= 42 && nameRisk <= 14) {
    return { tier: 'strong', reason: 'SEO与快速热度均通过' };
  }

  if (
    fastClass === 'watch' &&
    seoScore >= 44 &&
    nameRisk <= 14 &&
    (evidence.hasStrategicSource || evidence.sourceCount >= 2 || evidence.youtubeChannels >= 2)
  ) {
    return { tier: 'secondary', reason: 'SEO通过，快速热度待确认但已有扩散信号' };
  }

  if (
    evidence.hasStrategicSource &&
    seoScore >= 38 &&
    nameRisk <= 16 &&
    ['pass', 'watch', 'weak'].includes(fastClass) &&
    (recent || evidence.sourceCount >= 2 || evidence.youtubeChannels >= 2 || fastScore >= 20)
  ) {
    return { tier: 'strategic', reason: '来自Steam热门、itch热门或其他战略来源' };
  }

  return null;
}

export function trendQueueScore(candidate, tier) {
  const evidence = strategicEvidence(candidate);
  const tierBoost = { strong: 300, secondary: 180, strategic: 100 }[tier] || 0;
  let score = tierBoost;
  score += Number(candidate.seo?.score || 0) * 2;
  score += Number(candidate.fast?.score || 0) * 2;
  score += Number(candidate.discoveryScore || 0) * 3;
  score += evidence.strategicKindCount * 20;
  score += Math.min(30, evidence.sourceCount * 8);
  score += Math.min(30, evidence.youtubeChannels * 5);
  const age = Date.now() - Date.parse(candidate.firstSeen || 0);
  if (Number.isFinite(age) && age < 2 * DAY) score += 20;
  return score;
}

export function buildTieredTrendQueue(candidates, caps = { strong: 3, secondary: 3, strategic: 2 }) {
  const groups = { strong: [], secondary: [], strategic: [] };
  for (const candidate of candidates) {
    const classified = classifyTrendTier(candidate);
    if (!classified) continue;
    groups[classified.tier].push({
      candidate,
      tier: classified.tier,
      reason: classified.reason,
      priority: trendQueueScore(candidate, classified.tier),
    });
  }

  for (const tier of Object.keys(groups)) groups[tier].sort((a, b) => b.priority - a.priority);

  return [
    ...groups.strong.slice(0, Math.max(0, Number(caps.strong || 0))),
    ...groups.secondary.slice(0, Math.max(0, Number(caps.secondary || 0))),
    ...groups.strategic.slice(0, Math.max(0, Number(caps.strategic || 0))),
  ];
}
