import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateTrendVerdict, TREND_MODEL_VERSION, TREND_PROFILE_VERSION } from './trend-verifier.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usagePath = path.join(root, 'data', 'searchapi-usage.json');
const API_KEY = process.env.SEARCHAPI_API_KEY || '';
const TIMEOUT_MS = Math.max(10000, Number(process.env.SEARCHAPI_TIMEOUT_MS || 45000));
const TOTAL_LIMIT = Math.max(1, Number(process.env.SEARCHAPI_TOTAL_LIMIT || 95));

function normalize(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function numeric(value) {
  const number = Number(String(value ?? 0).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function maxTimelines(...timelines) {
  const length = Math.max(0, ...timelines.map((values) => values.length));
  return Array.from({ length }, (_, index) => Math.max(0, ...timelines.map((values) => Number(values[index] || 0))));
}

export function buildSearchApiProfile(gameName, siteType = 'pending') {
  if (siteType === 'online') {
    return {
      siteType,
      name: 'online-searchapi-v1',
      anchor: 'crazy games',
      queries: [gameName, `${gameName} online`, `play ${gameName}`, 'crazy games'],
      supportIndexes: [1, 2],
      supportLabel: `${gameName} online / play ${gameName}`,
    };
  }
  if (siteType === 'wiki') {
    return {
      siteType,
      name: 'wiki-searchapi-v1',
      anchor: 'steam',
      queries: [gameName, `${gameName} wiki`, `${gameName} guide`, 'steam'],
      supportIndexes: [1, 2],
      supportLabel: `${gameName} wiki / ${gameName} guide`,
    };
  }
  return {
    siteType: 'pending',
    name: 'generic-searchapi-v1',
    anchor: 'itch io',
    queries: [gameName, `${gameName} game`, 'itch io'],
    supportIndexes: [1],
    supportLabel: `${gameName} game`,
  };
}

export function parseSearchApiTimelines(payload = {}, queries = []) {
  const timeline = payload?.interest_over_time?.timeline_data || [];
  const normalizedQueries = queries.map(normalize);
  const timelines = queries.map(() => []);
  const dates = [];
  for (const point of timeline) {
    dates.push(String(point?.date || point?.timestamp || ''));
    const values = Array.isArray(point?.values) ? point.values : [];
    const byQuery = new Map();
    for (const value of values) {
      const key = normalize(value?.query || '');
      if (key) byQuery.set(key, numeric(value?.extracted_value ?? value?.value));
    }
    for (let index = 0; index < queries.length; index += 1) {
      const fallback = values[index] || {};
      const value = byQuery.has(normalizedQueries[index])
        ? byQuery.get(normalizedQueries[index])
        : numeric(fallback?.extracted_value ?? fallback?.value);
      timelines[index].push(value);
    }
  }
  return { timelines, dates };
}

async function readUsage() {
  let stored = {};
  try { stored = JSON.parse(await fs.readFile(usagePath, 'utf8')); } catch {}
  return {
    totalUsed: Number(stored.totalUsed || 0),
    totalLimit: TOTAL_LIMIT,
    updatedAt: stored.updatedAt || null,
    lastError: stored.lastError || null,
  };
}

async function saveUsage(usage) {
  const updated = { ...usage, totalLimit: TOTAL_LIMIT, updatedAt: new Date().toISOString() };
  await fs.writeFile(usagePath, JSON.stringify(updated, null, 2) + '\n');
  return updated;
}

async function ensureQuota() {
  const usage = await readUsage();
  if (usage.totalUsed >= TOTAL_LIMIT) {
    const error = new Error('SearchApi免费安全额度已用完');
    error.code = 'SEARCHAPI_QUOTA_GUARD';
    throw error;
  }
  return usage;
}

async function recordSuccess() {
  const usage = await readUsage();
  usage.totalUsed += 1;
  usage.lastError = null;
  return saveUsage(usage);
}

async function recordError(message) {
  const usage = await readUsage();
  usage.lastError = String(message || '').slice(0, 300);
  return saveUsage(usage);
}

export async function getSearchApiUsage() {
  return { enabled: Boolean(API_KEY), ...await readUsage() };
}

export function isSearchApiConfigured() {
  return Boolean(API_KEY);
}

async function fetchComparison(profile, market = 'US') {
  await ensureQuota();
  const params = new URLSearchParams({
    engine: 'google_trends',
    data_type: 'TIMESERIES',
    q: profile.queries.join(','),
    geo: market,
    time: 'today 3-m',
    tz: '240',
    gprop: '',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`https://www.searchapi.io/api/v1/search?${params}`, {
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      const message = payload?.error?.message || payload?.error || payload?.message || `SearchApi returned HTTP ${response.status}`;
      await recordError(message);
      const error = new Error(String(message));
      error.code = [401, 402, 429].includes(response.status) || /credit|quota|limit|request/i.test(String(message)) ? 'SEARCHAPI_QUOTA_GUARD' : 'SEARCHAPI_UNAVAILABLE';
      throw error;
    }
    await recordSuccess();
    const parsed = parseSearchApiTimelines(payload, profile.queries);
    return {
      candidate: parsed.timelines[0] || [],
      qualified: maxTimelines(...profile.supportIndexes.map((index) => parsed.timelines[index] || [])),
      anchor: parsed.timelines[profile.queries.length - 1] || [],
      dates: parsed.dates,
      searchId: payload?.search_metadata?.id || null,
      requestTime: payload?.search_metadata?.total_time_taken ?? payload?.search_metadata?.request_time_taken ?? null,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('SearchApi请求超时');
      timeoutError.code = 'SEARCHAPI_UNAVAILABLE';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifySearchApiTrendDemand(gameName, { siteType = 'pending', market = 'US' } = {}) {
  const profile = buildSearchApiProfile(gameName, siteType);
  const comparison = await fetchComparison(profile, market);
  const thirtyCount = Math.min(30, comparison.candidate.length);
  const sevenCount = Math.min(7, comparison.candidate.length);
  const verdict = calculateTrendVerdict({
    gameName,
    sevenDayCandidate: comparison.candidate.slice(-sevenCount),
    sevenDayQualified: comparison.qualified.slice(-sevenCount),
    sevenDayAnchor: comparison.anchor.slice(-sevenCount),
    thirtyDayCandidate: comparison.candidate.slice(-thirtyCount),
    thirtyDayQualified: comparison.qualified.slice(-thirtyCount),
    thirtyDayAnchor: comparison.anchor.slice(-thirtyCount),
    ninetyDayCandidate: comparison.candidate,
    ninetyDayQualified: comparison.qualified,
    ninetyDayAnchor: comparison.anchor,
    anchor: profile.anchor,
    qualifiedQuery: profile.supportLabel,
    siteType: profile.siteType,
    queryProfile: profile.name,
  });
  return {
    ...verdict,
    modelVersion: TREND_MODEL_VERSION,
    profileVersion: TREND_PROFILE_VERSION,
    checkedAt: new Date().toISOString(),
    status: 'ok',
    provider: 'searchapi',
    apiRequests: 1,
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
    searchApiSearchId: comparison.searchId,
    requestTime: comparison.requestTime,
    timelineDates: comparison.dates,
    searchApiUsage: await getSearchApiUsage(),
  };
}
