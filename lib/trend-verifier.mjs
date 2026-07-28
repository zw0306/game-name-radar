import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const googleTrends = require('google-trends-api');

const MODEL_VERSION = 1;
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

function summarize(values) {
  const nonZero = values.filter((value) => value > 0);
  const split = Math.max(1, Math.floor(values.length * 0.7));
  const earlier = values.slice(0, split);
  const recent = values.slice(split);
  const earlierAvg = average(earlier);
  const recentAvg = average(recent);
  return {
    points: values.length,
    average: Number(average(values).toFixed(2)),
    peak: values.length ? Math.max(...values) : 0,
    nonZero: nonZero.length,
    coverage: values.length ? Number((nonZero.length / values.length).toFixed(2)) : 0,
    recentAverage: Number(recentAvg.toFixed(2)),
    momentum: earlierAvg > 0 ? Number((recentAvg / earlierAvg).toFixed(2)) : recentAvg > 0 ? 3 : 0,
  };
}

function ratio(candidate, anchor) {
  return anchor.average > 0 ? Number((candidate.average / anchor.average).toFixed(3)) : 0;
}

export function calculateTrendVerdict({ gameName, sevenDayCandidate = [], sevenDayAnchor = [], thirtyDayCandidate = [], thirtyDayAnchor = [], anchor = DEFAULT_ANCHOR }) {
  const seven = summarize(sevenDayCandidate);
  const sevenAnchor = summarize(sevenDayAnchor);
  const thirty = summarize(thirtyDayCandidate);
  const thirtyAnchor = summarize(thirtyDayAnchor);
  const ratio7 = ratio(seven, sevenAnchor);
  const ratio30 = ratio(thirty, thirtyAnchor);

  let score = 0;
  score += Math.min(35, Math.round(ratio30 * 140));
  score += Math.min(30, Math.round(ratio7 * 120));
  score += Math.round(thirty.coverage * 15);
  score += Math.round(seven.coverage * 10);
  if (seven.momentum >= 1.5 && seven.recentAverage >= 2) score += 10;
  score = Math.max(0, Math.min(100, score));

  const noData = seven.nonZero === 0 && thirty.nonZero === 0;
  const veryWeak = ratio7 < 0.025 && ratio30 < 0.02 && seven.coverage < 0.12 && thirty.coverage < 0.12;
  const rising = ratio7 >= 0.04 && seven.momentum >= 1.6 && ratio7 >= Math.max(0.04, ratio30 * 1.35);

  let classification = 'weak';
  if (noData) classification = 'none';
  else if (veryWeak) classification = 'weak';
  else if (rising) classification = 'rising';
  else if (ratio7 >= 0.12 || ratio30 >= 0.1 || score >= 55) classification = 'strong';
  else if (ratio7 >= 0.04 || ratio30 >= 0.035 || score >= 28) classification = 'moderate';

  const reasons = [];
  if (classification === 'none') reasons.push('Google Trends 7天和30天均无可见需求');
  else {
    reasons.push(`7天热度约为 ${anchor} 的 ${(ratio7 * 100).toFixed(1)}%`);
    reasons.push(`30天热度约为 ${anchor} 的 ${(ratio30 * 100).toFixed(1)}%`);
    if (rising) reasons.push(`最近趋势加速，动量 ${seven.momentum}x`);
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
