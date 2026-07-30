import { parseApifyFastTimeline, summarizeStandaloneTimeline, calculateStandaloneTrendVerdict } from './apify-fast-trends.mjs';

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || '';
const ACTOR_ID = process.env.APIFY_FAST_TRENDS_ACTOR_ID || 'data_xplorer~google-trends-fast-scraper';
const TIMEOUT_MS = Math.max(60000, Number(process.env.APIFY_TRENDS_TIMEOUT_MS || 150000));
const MAX_CHARGE_USD = Math.max(0.001, Number(process.env.APIFY_TRENDS_MAX_CHARGE_USD || 0.05));

function profileFor(gameName, siteType) {
  if (siteType === 'online') return { qualifiedQuery: `${gameName} online`, name: 'online-apify-residential-v1' };
  if (siteType === 'wiki') return { qualifiedQuery: `${gameName} wiki`, name: 'wiki-apify-residential-v1' };
  return { qualifiedQuery: `${gameName} game`, name: 'generic-apify-residential-v1' };
}

function shouldConfirmGameIntent(summary) {
  if (!summary || summary.nonZero < 2) return false;
  if (summary.recentAverage >= 10 && summary.recentCoverage >= 0.43) return true;
  if (summary.recentAverage >= 5 && summary.recentCoverage >= 0.29 && (summary.momentum >= 1.3 || summary.slope > 0.02 || summary.peak >= 20)) return true;
  return false;
}

async function fetchKeyword(keyword, market = 'US') {
  if (!APIFY_API_TOKEN) {
    const error = new Error('APIFY_API_TOKEN is not configured');
    error.code = 'APIFY_NOT_CONFIGURED';
    error.actorCalls = 0;
    throw error;
  }
  const params = new URLSearchParams({ clean: 'true', format: 'json', timeout: String(Math.ceil(TIMEOUT_MS / 1000)), maxTotalChargeUsd: String(MAX_CHARGE_USD) });
  const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS + 15000);
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
        proxyConfiguration: {
          useApifyProxy: true,
          apifyProxyGroups: ['RESIDENTIAL'],
        },
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
      error.actorCalls = 1;
      throw error;
    }
    const items = Array.isArray(payload) ? payload : [payload];
    const item = items.find((entry) => entry?.timeline_data) || null;
    if (!item?.timeline_data) {
      const error = new Error('Apify residential Trends actor returned no timeline_data');
      error.code = 'APIFY_TRENDS_EMPTY';
      error.actorCalls = 1;
      throw error;
    }
    const timeline = parseApifyFastTimeline(item, keyword, { excludePartial: true });
    return { item, timeline, itemCount: items.length, actorCalls: 1 };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Apify residential Trends request timed out');
      timeoutError.code = 'APIFY_TRENDS_UNAVAILABLE';
      timeoutError.actorCalls = 1;
      throw timeoutError;
    }
    if (!Number.isFinite(error.actorCalls)) error.actorCalls = 1;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyApifyResidentialTrendDemand(gameName, { siteType = 'pending', market = 'US' } = {}) {
  const profile = profileFor(gameName, siteType);
  let actorCalls = 0;
  let exact;
  try {
    exact = await fetchKeyword(gameName, market);
    actorCalls += exact.actorCalls;
  } catch (error) {
    error.actorCalls = actorCalls + Number(error.actorCalls || 1);
    throw error;
  }

  const exactSummary = summarizeStandaloneTimeline(exact.timeline.values, 7);
  let qualified = { timeline: { values: [], dates: [], points: [] }, itemCount: 0, actorCalls: 0 };
  if (shouldConfirmGameIntent(exactSummary)) {
    try {
      qualified = await fetchKeyword(profile.qualifiedQuery, market);
      actorCalls += qualified.actorCalls;
    } catch (error) {
      error.actorCalls = actorCalls + Number(error.actorCalls || 1);
      throw error;
    }
  }

  const verdict = calculateStandaloneTrendVerdict({
    gameName,
    exactValues: exact.timeline.values,
    qualifiedValues: qualified.timeline.values,
    siteType,
    qualifiedQuery: profile.qualifiedQuery,
  });
  const intentSkipped = !shouldConfirmGameIntent(exactSummary);
  if (intentSkipped) {
    verdict.reasons = [...(verdict.reasons || []), '裸词未达到上涨候选门槛，未额外消耗一次游戏意图查询'];
  }

  return {
    checkedAt: new Date().toISOString(),
    status: 'ok',
    provider: 'apify-data-xplorer',
    apifyActorId: ACTOR_ID,
    proxyGroup: 'RESIDENTIAL',
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
    gameIntentQuerySkipped: intentSkipped,
    ...verdict,
  };
}

export function isApifyResidentialTrendsConfigured() {
  return Boolean(APIFY_API_TOKEN);
}
