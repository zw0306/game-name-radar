import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const googleTrends = require('google-trends-api');

const MODEL_VERSION = 3;
const DEFAULT_ANCHOR = process.env.TRENDS_ANCHOR || 'itch io';

function parseTimeline(raw, keywordIndex = 0) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const timeline = data?.default?.timelineData || [];
  return timeline.map((item) => Number(item?.value?.[keywordIndex] || 0));
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizedSlope(values) {
  if (values.length < 3) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = average(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (i - xMean) * (values[i] - yMean);
    denominator += (i - xMean) ** 2;
  }
  if (!denominator) return 0;
  return Number(((numerator / denominator) / Math.max(1, yMean)).toFixed(3));
}

function summarize(values, recentCount) {
  if (!values.length) {
    return {
      points: 0, average: 0, peak: 0, nonZero: 0, coverage: 0,
      earlierAverage: 0, earlierCoverage: 0, recentAverage: 0,
      recentCoverage: 0, momentum: 0, slope: 0,
    };
  }
  const count = Math.max(1, Math.min(values.length, recentCount));
  const earlier = values.slice(0, Math.max(0, values.length - count));
  const recent = values.slice(-count);
  const nonZero = values.filter((value) => value > 0);
  const earlierNonZero = earlier.filter((value) => value > 0).length;
  const recentNonZero = recent.filter((value) => value > 0).length;
  const earlierAvg = average(earlier);
  const recentAvg = average(recent);
  const momentum = earlierAvg > 0 ? recentAvg / earlierAvg : recentAvg > 0 ? 4 : 0;
  return {
    points: values.length,
    average: Number(average(values).toFixed(2)),
    peak: Math.max(...values),
    nonZero: nonZero.length,
    coverage: Number((nonZero.length / values.length).toFixed(2)),
    earlierAverage: Number(earlierAvg.toFixed(2)),
    earlierCoverage: earlier.length ? Number((earlierNonZero / earlier.length).toFixed(2)) : 0,
    recentAverage: Number(recentAvg.toFixed(2)),
    recentCoverage: recent.length ? Number((recentNonZero / recent.length).toFixed(2)) : 0,
    momentum: Number(Math.min(9.99, momentum).toFixed(2)),
    slope: normalizedSlope(values),
  };
}

function ratio(candidate, anchor) {
  return anchor.average > 0 ? Number((candidate.average / anchor.average).toFixed(3)) : 0;
}

function detectsRising(summary, { minRecent, minCoverage, minMomentum, minSlope }) {
  return summary.recentAverage >= minRecent && summary.recentCoverage >= minCoverage &&
    summary.momentum >= minMomentum && summary.slope > minSlope;
}

function detectsBreakout(summary, { minRecent, minCoverage, minMomentum }) {
  return summary.recentAverage >= minRecent && summary.recentCoverage >= minCoverage &&
    ((summary.earlierAverage <= 0.5 && summary.peak >= 8) || summary.momentum >= minMomentum);
}

export function calculateTrendVerdict({
  gameName,
  sevenDayCandidate = [], sevenDayQualified = [], sevenDayAnchor = [],
  thirtyDayCandidate = [], thirtyDayQualified = [], thirtyDayAnchor = [],
  ninetyDayCandidate = [], ninetyDayQualified = [], ninetyDayAnchor = [],
  anchor = DEFAULT_ANCHOR,
}) {
  const seven = summarize(sevenDayCandidate, Math.max(2, Math.ceil(sevenDayCandidate.length * 0.3)));
  const sevenQualified = summarize(sevenDayQualified, Math.max(2, Math.ceil(sevenDayQualified.length * 0.3)));
  const sevenAnchor = summarize(sevenDayAnchor, Math.max(2, Math.ceil(sevenDayAnchor.length * 0.3)));
  const thirty = summarize(thirtyDayCandidate, Math.max(7, Math.ceil(thirtyDayCandidate.length * 0.23)));
  const thirtyQualified = summarize(thirtyDayQualified, Math.max(7, Math.ceil(thirtyDayQualified.length * 0.23)));
  const thirtyAnchor = summarize(thirtyDayAnchor, Math.max(7, Math.ceil(thirtyDayAnchor.length * 0.23)));
  const ninety = summarize(ninetyDayCandidate, Math.max(30, Math.ceil(ninetyDayCandidate.length * 0.33)));
  const ninetyQualified = summarize(ninetyDayQualified, Math.max(30, Math.ceil(ninetyDayQualified.length * 0.33)));
  const ninetyAnchor = summarize(ninetyDayAnchor, Math.max(30, Math.ceil(ninetyDayAnchor.length * 0.33)));

  const ratio7 = ratio(seven, sevenAnchor);
  const ratio30 = ratio(thirty, thirtyAnchor);
  const ratio90 = ratio(ninety, ninetyAnchor);
  const qualifiedRatio7 = ratio(sevenQualified, sevenAnchor);
  const qualifiedRatio30 = ratio(thirtyQualified, thirtyAnchor);
  const qualifiedRatio90 = ratio(ninetyQualified, ninetyAnchor);

  const isolatedSpike7 = seven.nonZero <= 1 || (seven.recentCoverage < 0.34 && seven.peak > seven.recentAverage * 3);
  const isolatedSpike30 = thirty.nonZero <= 2 || (thirty.recentCoverage < 0.29 && thirty.peak > thirty.recentAverage * 4);

  const exactBreakout7 = !isolatedSpike7 && detectsBreakout(seven, { minRecent: 3, minCoverage: 0.66, minMomentum: 2.8 });
  const exactBreakout30 = !isolatedSpike30 && detectsBreakout(thirty, { minRecent: 2, minCoverage: 0.57, minMomentum: 2.5 });
  const qualifiedBreakout7 = detectsBreakout(sevenQualified, { minRecent: 1.5, minCoverage: 0.5, minMomentum: 2.5 });
  const qualifiedBreakout30 = detectsBreakout(thirtyQualified, { minRecent: 1.2, minCoverage: 0.43, minMomentum: 2.2 });

  const exactRising7 = !isolatedSpike7 && detectsRising(seven, { minRecent: 1.5, minCoverage: 0.5, minMomentum: 1.8, minSlope: 0.08 });
  const exactRising30 = !isolatedSpike30 && detectsRising(thirty, { minRecent: 1.2, minCoverage: 0.43, minMomentum: 1.65, minSlope: 0.025 });
  const qualifiedRising7 = detectsRising(sevenQualified, { minRecent: 1, minCoverage: 0.43, minMomentum: 1.7, minSlope: 0.06 });
  const qualifiedRising30 = detectsRising(thirtyQualified, { minRecent: 0.8, minCoverage: 0.36, minMomentum: 1.55, minSlope: 0.02 });

  const breakout7 = exactBreakout7 || qualifiedBreakout7;
  const breakout30 = exactBreakout30 || qualifiedBreakout30;
  const rising7 = exactRising7 || qualifiedRising7;
  const rising30 = exactRising30 || qualifiedRising30;

  let keywordFreshness = 'unknown';
  if (ninety.points >= 45) {
    if (ninety.earlierAverage >= 4 && ninety.earlierCoverage >= 0.45) keywordFreshness = 'existing';
    else if (ninety.earlierAverage <= 1 && ninety.recentAverage >= 3 && ninety.recentCoverage >= 0.4) keywordFreshness = 'new';
  }
  const entityConflict = keywordFreshness === 'existing' &&
    (qualifiedRatio90 < Math.max(0.01, ratio90 * 0.25) || ninetyQualified.coverage < 0.2);

  let score = 0;
  score += Math.min(20, Math.round(ratio30 * 100));
  score += Math.min(16, Math.round(ratio7 * 80));
  score += Math.min(12, Math.round(qualifiedRatio30 * 150));
  score += Math.min(10, Math.round(qualifiedRatio7 * 130));
  score += Math.round(thirty.coverage * 8);
  score += Math.round(seven.coverage * 6);
  if (rising7) score += 18;
  if (rising30) score += 15;
  if (breakout7 || breakout30) score += 20;
  if (keywordFreshness === 'new') score += 8;
  if (keywordFreshness === 'existing') score -= 8;
  if (entityConflict) score -= 12;
  if (isolatedSpike7 && isolatedSpike30) score -= 12;
  score = Math.max(0, Math.min(100, score));

  const noData = seven.nonZero === 0 && thirty.nonZero === 0 && sevenQualified.nonZero === 0 && thirtyQualified.nonZero === 0;
  const veryWeak = ratio7 < 0.02 && ratio30 < 0.015 && qualifiedRatio7 < 0.01 && qualifiedRatio30 < 0.01;

  let classification = 'weak';
  if (noData) classification = 'none';
  else if (breakout7 || breakout30) classification = 'breakout';
  else if (rising7 || rising30) classification = 'rising';
  else if (veryWeak || (isolatedSpike7 && isolatedSpike30)) classification = 'weak';
  else if (ratio7 >= 0.12 || ratio30 >= 0.1 || score >= 58) classification = 'strong';
  else if (ratio7 >= 0.04 || ratio30 >= 0.035 || qualifiedRatio30 >= 0.02 || score >= 30) classification = 'moderate';

  const reasons = [];
  if (classification === 'none') reasons.push('Google Trends 7天和30天均无可见需求');
  else {
    reasons.push(`主词7天热度约为 ${anchor} 的 ${(ratio7 * 100).toFixed(1)}%`);
    reasons.push(`主词30天热度约为 ${anchor} 的 ${(ratio30 * 100).toFixed(1)}%`);
    if (sevenQualified.points) reasons.push(`“${gameName} game” 30天热度约为 ${anchor} 的 ${(qualifiedRatio30 * 100).toFixed(1)}%`);
    if (keywordFreshness === 'existing') reasons.push('90天前段已有持续热度，关键词本身不是新出现');
    else if (keywordFreshness === 'new') reasons.push('90天前段接近无量，近期才开始形成搜索需求');
    if (entityConflict) reasons.push('主词历史热度主要可能来自其他实体，不应归因于这款新游戏');
    if (breakout7) reasons.push('7天出现Breakout');
    else if (breakout30) reasons.push('30天出现Breakout');
    else if (rising7) reasons.push('7天持续上涨');
    else if (rising30) reasons.push('30天持续上涨');
    else if (isolatedSpike7 || isolatedSpike30) reasons.push('存在孤立尖峰，暂不视为持续上涨');
  }

  return {
    modelVersion: MODEL_VERSION,
    queryName: gameName,
    qualifiedQuery: `${gameName} game`,
    anchor,
    score,
    classification,
    reasons,
    ratio7,
    ratio30,
    ratio90,
    qualifiedRatio7,
    qualifiedRatio30,
    qualifiedRatio90,
    rising7,
    rising30,
    breakout7,
    breakout30,
    exactRising7,
    exactRising30,
    qualifiedRising7,
    qualifiedRising30,
    keywordFreshness,
    entityConflict,
    sevenDay: seven,
    thirtyDay: thirty,
    ninetyDay: ninety,
    sevenDayQualified: sevenQualified,
    thirtyDayQualified: thirtyQualified,
    ninetyDayQualified: ninetyQualified,
  };
}

async function fetchComparison(keyword, days, anchor = DEFAULT_ANCHOR) {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 86400000);
  const raw = await googleTrends.interestOverTime({
    keyword: [keyword, `${keyword} game`, anchor],
    startTime,
    endTime,
    geo: 'US',
    hl: 'en-US',
    timezone: 240,
  });
  return {
    candidate: parseTimeline(raw, 0),
    qualified: parseTimeline(raw, 1),
    anchor: parseTimeline(raw, 2),
  };
}

export async function verifyTrendDemand(gameName, anchor = DEFAULT_ANCHOR) {
  const thirty = await fetchComparison(gameName, 30, anchor);
  const ninety = await fetchComparison(gameName, 90, anchor);
  const recentPoints = Math.min(8, thirty.candidate.length || 8);
  return {
    checkedAt: new Date().toISOString(),
    provider: 'google-trends-api',
    ...calculateTrendVerdict({
      gameName,
      sevenDayCandidate: thirty.candidate.slice(-recentPoints),
      sevenDayQualified: thirty.qualified.slice(-recentPoints),
      sevenDayAnchor: thirty.anchor.slice(-recentPoints),
      thirtyDayCandidate: thirty.candidate,
      thirtyDayQualified: thirty.qualified,
      thirtyDayAnchor: thirty.anchor,
      ninetyDayCandidate: ninety.candidate,
      ninetyDayQualified: ninety.qualified,
      ninetyDayAnchor: ninety.anchor,
      anchor,
    }),
  };
}
