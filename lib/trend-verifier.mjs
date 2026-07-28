import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const googleTrends = require('google-trends-api');

const MODEL_VERSION = 2;
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
  const nonZero = values.filter((value) => value > 0);
  const count = Math.max(1, Math.min(values.length - 1 || 1, recentCount));
  const earlier = values.slice(0, Math.max(1, values.length - count));
  const recent = values.slice(-count);
  const earlierAvg = average(earlier);
  const recentAvg = average(recent);
  const recentNonZero = recent.filter(value => value > 0).length;
  const momentum = earlierAvg > 0 ? recentAvg / earlierAvg : recentAvg > 0 ? 4 : 0;
  return {
    points: values.length,
    average: Number(average(values).toFixed(2)),
    peak: values.length ? Math.max(...values) : 0,
    nonZero: nonZero.length,
    coverage: values.length ? Number((nonZero.length / values.length).toFixed(2)) : 0,
    earlierAverage: Number(earlierAvg.toFixed(2)),
    recentAverage: Number(recentAvg.toFixed(2)),
    recentCoverage: recent.length ? Number((recentNonZero / recent.length).toFixed(2)) : 0,
    momentum: Number(Math.min(9.99, momentum).toFixed(2)),
    slope: normalizedSlope(values),
  };
}

function ratio(candidate, anchor) {
  return anchor.average > 0 ? Number((candidate.average / anchor.average).toFixed(3)) : 0;
}

export function calculateTrendVerdict({ gameName, sevenDayCandidate = [], sevenDayAnchor = [], thirtyDayCandidate = [], thirtyDayAnchor = [], anchor = DEFAULT_ANCHOR }) {
  const seven = summarize(sevenDayCandidate, Math.max(2, Math.ceil(sevenDayCandidate.length * 0.3)));
  const sevenAnchor = summarize(sevenDayAnchor, Math.max(2, Math.ceil(sevenDayAnchor.length * 0.3)));
  const thirty = summarize(thirtyDayCandidate, Math.max(7, Math.ceil(thirtyDayCandidate.length * 0.23)));
  const thirtyAnchor = summarize(thirtyDayAnchor, Math.max(7, Math.ceil(thirtyDayAnchor.length * 0.23)));
  const ratio7 = ratio(seven, sevenAnchor);
  const ratio30 = ratio(thirty, thirtyAnchor);

  const isolatedSpike7 = seven.nonZero <= 1 || (seven.recentCoverage < 0.34 && seven.peak > seven.recentAverage * 3);
  const isolatedSpike30 = thirty.nonZero <= 2 || (thirty.recentCoverage < 0.29 && thirty.peak > thirty.recentAverage * 4);

  const breakout7 = !isolatedSpike7 && seven.recentAverage >= 3 && seven.recentCoverage >= 0.66 &&
    ((seven.earlierAverage <= 0.5 && seven.peak >= 8) || seven.momentum >= 2.8);
  const breakout30 = !isolatedSpike30 && thirty.recentAverage >= 2 && thirty.recentCoverage >= 0.57 &&
    ((thirty.earlierAverage <= 0.5 && thirty.peak >= 8) || thirty.momentum >= 2.5);

  const rising7 = !isolatedSpike7 && seven.recentAverage >= 1.5 && seven.recentCoverage >= 0.5 &&
    seven.momentum >= 1.8 && seven.slope > 0.08;
  const rising30 = !isolatedSpike30 && thirty.recentAverage >= 1.2 && thirty.recentCoverage >= 0.43 &&
    thirty.momentum >= 1.65 && thirty.slope > 0.025;

  let score = 0;
  score += Math.min(24, Math.round(ratio30 * 110));
  score += Math.min(20, Math.round(ratio7 * 100));
  score += Math.round(thirty.coverage * 10);
  score += Math.round(seven.coverage * 8);
  if (rising7) score += 18;
  if (rising30) score += 15;
  if (breakout7 || breakout30) score += 20;
  if (isolatedSpike7 && isolatedSpike30) score -= 12;
  score = Math.max(0, Math.min(100, score));

  const noData = seven.nonZero === 0 && thirty.nonZero === 0;
  const veryWeak = ratio7 < 0.02 && ratio30 < 0.015 && seven.coverage < 0.15 && thirty.coverage < 0.15;

  let classification = 'weak';
  if (noData) classification = 'none';
  else if (breakout7 || breakout30) classification = 'breakout';
  else if (rising7 || rising30) classification = 'rising';
  else if (veryWeak || (isolatedSpike7 && isolatedSpike30)) classification = 'weak';
  else if (ratio7 >= 0.12 || ratio30 >= 0.1 || score >= 58) classification = 'strong';
  else if (ratio7 >= 0.04 || ratio30 >= 0.035 || score >= 30) classification = 'moderate';

  const reasons = [];
  if (classification === 'none') reasons.push('Google Trends 7天和30天均无可见需求');
  else {
    reasons.push(`7天热度约为 ${anchor} 的 ${(ratio7 * 100).toFixed(1)}%`);
    reasons.push(`30天热度约为 ${anchor} 的 ${(ratio30 * 100).toFixed(1)}%`);
    if (breakout7) reasons.push(`7天出现Breakout，后段热度是前段的 ${seven.momentum}x`);
    else if (breakout30) reasons.push(`30天出现Breakout，最近7天是此前的 ${thirty.momentum}x`);
    else if (rising7) reasons.push(`7天持续上涨，后段热度是前段的 ${seven.momentum}x`);
    else if (rising30) reasons.push(`30天持续上涨，最近7天是此前的 ${thirty.momentum}x`);
    else if (isolatedSpike7 || isolatedSpike30) reasons.push('存在孤立尖峰，暂不视为持续上涨');
    else if (seven.coverage < 0.15) reasons.push('7天有效数据点较少');
  }

  return {
    modelVersion: MODEL_VERSION,
    queryName: gameName,
    anchor,
    score,
    classification,
    reasons,
    ratio7,
    ratio30,
    rising7,
    rising30,
    breakout7,
    breakout30,
    sevenDay: seven,
    thirtyDay: thirty,
  };
}

async function fetchComparison(keyword, days, anchor = DEFAULT_ANCHOR) {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 86400000);
  const raw = await googleTrends.interestOverTime({
    keyword: [keyword, anchor],
    startTime,
    endTime,
    geo: 'US',
    hl: 'en-US',
    timezone: 240,
  });
  return {
    candidate: parseTimeline(raw, 0),
    anchor: parseTimeline(raw, 1),
  };
}

export async function verifyTrendDemand(gameName, anchor = DEFAULT_ANCHOR) {
  const seven = await fetchComparison(gameName, 7, anchor);
  const thirty = await fetchComparison(gameName, 30, anchor);
  return {
    checkedAt: new Date().toISOString(),
    provider: 'google-trends-api',
    ...calculateTrendVerdict({
      gameName,
      sevenDayCandidate: seven.candidate,
      sevenDayAnchor: seven.anchor,
      thirtyDayCandidate: thirty.candidate,
      thirtyDayAnchor: thirty.anchor,
      anchor,
    }),
  };
}
