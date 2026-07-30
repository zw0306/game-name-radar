const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || '';
const ACTOR_ID = process.env.APIFY_FAST_TRENDS_ACTOR_ID || 'data_xplorer~google-trends-fast-scraper';
const TIMEOUT_MS = Math.max(30000, Number(process.env.APIFY_TRENDS_TIMEOUT_MS || 150000));
const MAX_CHARGE_USD = Math.max(0.001, Number(process.env.APIFY_TRENDS_MAX_CHARGE_USD || 0.05));

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;
}

function normalizedSlope(values) {
  if (values.length < 3) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = average(values);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    numerator += (index - xMean) * (values[index] - yMean);
    denominator += (index - xMean) ** 2;
  }
  return denominator ? Number(((numerator / denominator) / Math.max(1, yMean)).toFixed(3)) : 0;
}

export function summarizeStandaloneTimeline(values = [], recentCount = 7) {
  const clean = values.map((value) => Number(value || 0)).filter(Number.isFinite);
  if (!clean.length) return { points: 0, average: 0, peak: 0, nonZero: 0, coverage: 0, earlierAverage: 0, earlierCoverage: 0, recentAverage: 0, recentCoverage: 0, recentNonZero: 0, momentum: 0, slope: 0 };
  const count = Math.max(1, Math.min(clean.length, recentCount));
  const earlier = clean.slice(0, Math.max(0, clean.length - count));
  const recent = clean.slice(-count);
  const nonZero = clean.filter((value) => value > 0).length;
  const earlierNonZero = earlier.filter((value) => value > 0).length;
  const recentNonZero = recent.filter((value) => value > 0).length;
  const earlierAverage = average(earlier);
  const recentAverage = average(recent);
  const momentum = earlierAverage > 0 ? recentAverage / earlierAverage : recentAverage > 0 ? 6 : 0;
  return {
    points: clean.length,
    average: Number(average(clean).toFixed(2)),
    peak: Math.max(...clean),
    nonZero,
    coverage: Number((nonZero / clean.length).toFixed(3)),
    earlierAverage: Number(earlierAverage.toFixed(2)),
    earlierCoverage: earlier.length ? Number((earlierNonZero / earlier.length).toFixed(3)) : 0,
    recentAverage: Number(recentAverage.toFixed(2)),
    recentCoverage: recent.length ? Number((recentNonZero / recent.length).toFixed(3)) : 0,
    recentNonZero,
    momentum: Number(Math.min(20, momentum).toFixed(2)),
    slope: normalizedSlope(clean),
  };
}

function timelineContainer(item = {}, keyword = '') {
  const timeline = item?.timeline_data;
  if (!timeline || typeof timeline !== 'object') return { valuesByDate: {}, partialByDate: {} };
  const partialByDate = timeline.isPartial && typeof timeline.isPartial === 'object' ? timeline.isPartial : {};
  if (timeline[keyword] && typeof timeline[keyword] === 'object') return { valuesByDate: timeline[keyword], partialByDate };
  const normalized = String(keyword).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const matchingKey = Object.keys(timeline).find((key) => key !== 'isPartial' && String(key).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === normalized);
  if (matchingKey && typeof timeline[matchingKey] === 'object') return { valuesByDate: timeline[matchingKey], partialByDate };
  const fallbackKey = Object.keys(timeline).find((key) => key !== 'isPartial' && timeline[key] && typeof timeline[key] === 'object');
  return { valuesByDate: fallbackKey ? timeline[fallbackKey] : {}, partialByDate };
}

export function parseApifyFastTimeline(item = {}, keyword = '', { excludePartial = true } = {}) {
  const { valuesByDate, partialByDate } = timelineContainer(item, keyword);
  const points = Object.entries(valuesByDate)
    .filter(([date]) => !excludePartial || partialByDate[date] !== true)
    .sort(([dateA], [dateB]) => String(dateA).localeCompare(String(dateB)))
    .map(([date, value]) => ({ date, value: Number(value || 0), isPartial: partialByDate[date] === true }))
    .filter((point) => Number.isFinite(point.value));
  return { points, dates: points.map((point) => point.date), values: points.map((point) => point.value) };
}

function isIsolatedSpike(summary) {
  return summary.nonZero <= 1 || (summary.recentCoverage < 0.29 && summary.peak > Math.max(8, summary.recentAverage * 2.8));
}

function breakout(summary, qualified = false) {
  const minRecent = qualified ? 8 : 15;
  const minCoverage = qualified ? 0.43 : 0.57;
  const minPeak = qualified ? 25 : 35;
  const minMomentum = qualified ? 2.6 : 3;
  const lowHistory = qualified ? 2 : 3;
  return !isIsolatedSpike(summary) && summary.recentAverage >= minRecent && summary.recentCoverage >= minCoverage && ((summary.earlierAverage <= lowHistory && summary.peak >= minPeak) || summary.momentum >= minMomentum);
}

function rising(summary, qualified = false) {
  const minRecent = qualified ? 6 : 10;
  const minCoverage = qualified ? 0.43 : 0.57;
  const minMomentum = qualified ? 1.5 : 1.65;
  const minSlope = qualified ? 0.025 : 0.035;
  return !isIsolatedSpike(summary) && summary.recentAverage >= minRecent && summary.recentCoverage >= minCoverage && summary.momentum >= minMomentum && summary.slope > minSlope;
}

export function calculateStandaloneTrendVerdict({ gameName, exactValues = [], qualifiedValues = [], siteType = 'pending', qualifiedQuery = `${gameName} game` }) {
  const exact = summarizeStandaloneTimeline(exactValues, 7);
  const qualified = summarizeStandaloneTimeline(qualifiedValues, 7);
  const exactBreakout = breakout(exact, false);
  const qualifiedBreakout = breakout(qualified, true);
  const exactRising = rising(exact, false);
  const qualifiedRising = rising(qualified, true);
  const isBreakout = exactBreakout || qualifiedBreakout;
  const isRising = exactRising || qualifiedRising;
  const noData = exact.nonZero === 0 && qualified.nonZero === 0;
  const gameIntentConfirmed = qualified.nonZero >= 3 && qualified.recentCoverage >= 0.29 && (qualified.recentAverage >= 2 || qualifiedRising || qualifiedBreakout);

  let keywordFreshness = 'unknown';
  if (exact.points >= 45) {
    if (exact.earlierAverage >= 10 && exact.earlierCoverage >= 0.4) keywordFreshness = 'existing';
    else if (exact.earlierAverage <= 3 && exact.recentAverage >= 10 && exact.recentCoverage >= 0.43) keywordFreshness = 'new';
  }
  const entityConflict = keywordFreshness === 'existing' && !gameIntentConfirmed && qualified.coverage < 0.15;

  let score = 0;
  score += Math.min(24, Math.round(exact.recentAverage * 0.35));
  score += Math.min(15, Math.round(exact.momentum * 3));
  score += Math.min(12, Math.max(0, Math.round(exact.slope * 45)));
  score += Math.round(exact.recentCoverage * 10);
  score += Math.min(14, Math.round(qualified.recentAverage * 0.35));
  score += Math.min(10, Math.round(qualified.momentum * 2));
  if (gameIntentConfirmed) score += 10;
  if (isRising) score += 14;
  if (isBreakout) score += 18;
  if (keywordFreshness === 'new') score += 8;
  if (keywordFreshness === 'existing') score -= 6;
  if (entityConflict) score -= 15;
  if (isIsolatedSpike(exact) && isIsolatedSpike(qualified)) score -= 12;
  score = Math.max(0, Math.min(100, score));

  let classification = 'weak';
  if (noData) classification = 'none';
  else if (isBreakout) classification = 'breakout';
  else if (isRising) classification = 'rising';
  else if (exact.recentAverage >= 20 && exact.recentCoverage >= 0.57) classification = 'strong';
  else if (exact.recentAverage >= 5 && exact.recentCoverage >= 0.29) classification = 'moderate';

  const reasons = [];
  if (classification === 'none') reasons.push('Apify趋势数据中主词和游戏意图组合词均无可见需求');
  else {
    reasons.push(`主词近7天平均相对热度 ${exact.recentAverage}，动量 ${exact.momentum}x`);
    if (qualified.points) reasons.push(`“${qualifiedQuery}”近7天平均相对热度 ${qualified.recentAverage}`);
    if (isBreakout) reasons.push('近90天基线较低，最近7天出现Breakout');
    else if (isRising) reasons.push('最近7天形成持续上涨');
    if (keywordFreshness === 'new') reasons.push('前段接近无量，近期才形成搜索需求');
    if (!gameIntentConfirmed) reasons.push('游戏意图组合词尚未形成足够热度，最终推荐降为观察');
    if (entityConflict) reasons.push('裸词历史热度可能来自其他实体');
  }
  reasons.push('Apify为单关键词归一化数据，不用于估算绝对搜索量或跨词流量比例');

  return {
    score,
    classification,
    reasons,
    siteType,
    queryProfile: `${siteType}-apify-v1`,
    queryName: gameName,
    qualifiedQuery,
    anchor: null,
    ratio7: null,
    ratio30: null,
    ratio90: null,
    qualifiedRatio7: null,
    qualifiedRatio30: null,
    qualifiedRatio90: null,
    rising7: isRising,
    rising30: isRising,
    breakout7: isBreakout,
    breakout30: isBreakout,
    exactRising7: exactRising,
    exactRising30: exactRising,
    qualifiedRising7: qualifiedRising,
    qualifiedRising30: qualifiedRising,
    keywordFreshness,
    entityConflict,
    gameIntentConfirmed,
    sevenDay: exact,
    thirtyDay: exact,
    ninetyDay: exact,
    sevenDayQualified: qualified,
    thirtyDayQualified: qualified,
    ninetyDayQualified: qualified,
    sourceScale: 'standalone-normalized',
  };
}

function profileFor(gameName, siteType) {
  if (siteType === 'online') return { qualifiedQuery: `${gameName} online`, name: 'online-apify-v1' };
  if (siteType === 'wiki') return { qualifiedQuery: `${gameName} wiki`, name: 'wiki-apify-v1' };
  return { qualifiedQuery: `${gameName} game`, name: 'generic-apify-v1' };
}

async function fetchKeyword(keyword, market = 'US') {
  if (!APIFY_API_TOKEN) {
    const error = new Error('APIFY_API_TOKEN is not configured');
    error.code = 'APIFY_NOT_CONFIGURED';
    throw error;
  }
  const params = new URLSearchParams({ clean: 'true', format: 'json', timeout: String(Math.ceil(TIMEOUT_MS / 1000)), maxTotalChargeUsd: String(MAX_CHARGE_USD) });
  const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS + 10000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${APIFY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'keyword',
        enableTrendingSearches: false,
        keyword,
        predefinedTimeframe: 'today 3-m',
        geo: market,
        fetchRegionalData: false,
        proxyConfiguration: { useApifyProxy: true },
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = text; }
    if (!response.ok) {
      const message = typeof payload === 'string' ? payload.slice(0, 500) : payload?.error?.message || payload?.message || `Apify returned HTTP ${response.status}`;
      const error = new Error(message);
      error.code = /charge|credit|limit|quota|billing/i.test(message) ? 'APIFY_QUOTA_GUARD' : 'APIFY_TRENDS_UNAVAILABLE';
      throw error;
    }
    const items = Array.isArray(payload) ? payload : [payload];
    const item = items.find((entry) => entry?.timeline_data) || items[0];
    if (!item?.timeline_data) {
      const error = new Error('Apify lightweight Trends actor returned no timeline_data');
      error.code = 'APIFY_TRENDS_EMPTY';
      throw error;
    }
    const timeline = parseApifyFastTimeline(item, keyword, { excludePartial: true });
    return { item, timeline, itemCount: items.length };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Apify lightweight Trends request timed out');
      timeoutError.code = 'APIFY_TRENDS_UNAVAILABLE';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyApifyTrendDemand(gameName, { siteType = 'pending', market = 'US' } = {}) {
  const profile = profileFor(gameName, siteType);
  const exact = await fetchKeyword(gameName, market);
  let actorCalls = 1;
  const exactSummary = summarizeStandaloneTimeline(exact.timeline.values, 7);
  let qualified = { timeline: { values: [], dates: [], points: [] }, itemCount: 0 };
  if (exactSummary.nonZero >= 2 || exactSummary.recentAverage > 0) {
    qualified = await fetchKeyword(profile.qualifiedQuery, market);
    actorCalls += 1;
  }
  const verdict = calculateStandaloneTrendVerdict({
    gameName,
    exactValues: exact.timeline.values,
    qualifiedValues: qualified.timeline.values,
    siteType,
    qualifiedQuery: profile.qualifiedQuery,
  });
  return {
    checkedAt: new Date().toISOString(),
    status: 'ok',
    provider: 'apify-data-xplorer',
    apifyActorId: ACTOR_ID,
    apiRequests: actorCalls,
    actorCalls,
    resultItems: Number(exact.itemCount || 0) + Number(qualified.itemCount || 0),
    targetMarket: market,
    primaryMarket: market,
    referenceMarket: null,
    marketStatus: ['rising', 'breakout'].includes(verdict.classification) ? 'us-rising' : 'no-rising',
    globalClassification: null,
    globalScore: null,
    globalRatio7: null,
    globalRatio30: null,
    globalRising7: false,
    globalRising30: false,
    globalBreakout7: false,
    globalBreakout30: false,
    globalKeywordFreshness: null,
    queryProfile: profile.name,
    exactTimelineDates: exact.timeline.dates,
    qualifiedTimelineDates: qualified.timeline.dates,
    ...verdict,
  };
}

export function isApifyFastTrendsConfigured() {
  return Boolean(APIFY_API_TOKEN);
}
