import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySiteType, SITE_TYPE_MODEL_VERSION } from '../lib/site-type.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const reportPath = path.join(root, 'data', 'latest-report.json');
const serpUsagePath = path.join(root, 'data', 'serpapi-usage.json');
const googleCseUsagePath = path.join(root, 'data', 'google-cse-usage.json');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}

const payload = await readJson(candidatesPath, { candidates: [] });
const candidates = Array.isArray(payload) ? payload : payload.candidates || [];
const counts = { online: 0, wiki: 0, pending: 0 };
const trendProviderCounts = {};
const seoProviderCounts = {};

for (const candidate of candidates) {
  candidate.siteType = classifySiteType(candidate);
  counts[candidate.siteType.type] = (counts[candidate.siteType.type] || 0) + 1;
  const trendProvider = candidate.trend?.provider;
  if (trendProvider) trendProviderCounts[trendProvider] = (trendProviderCounts[trendProvider] || 0) + 1;
  const seoProvider = candidate.seo?.provider;
  if (seoProvider) seoProviderCounts[seoProvider] = (seoProviderCounts[seoProvider] || 0) + 1;
}

await fs.writeFile(candidatesPath, JSON.stringify({ ...payload, candidates }, null, 2) + '\n');

const report = await readJson(reportPath, {});
const serpApiUsage = await readJson(serpUsagePath, {
  enabled: Boolean(process.env.SERPAPI_API_KEY), monthUsed: 0, dayUsed: 0,
  monthlyLimit: Number(process.env.SERPAPI_MONTHLY_LIMIT || 220), dailyLimit: Number(process.env.SERPAPI_DAILY_LIMIT || 8),
});
const configuredGoogleSlots = [
  Boolean(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX),
  Boolean(process.env.GOOGLE_CSE_API_KEY_2 && process.env.GOOGLE_CSE_CX_2),
].filter(Boolean).length;
const googleCseUsage = await readJson(googleCseUsagePath, {
  day: new Date().toISOString().slice(0, 10), slots: {}, updatedAt: null,
});
let googleDayUsed = 0;
let googleDailyLimit = 0;
for (const slot of Object.values(googleCseUsage.slots || {})) {
  googleDayUsed += Number(slot.dayUsed || 0);
  googleDailyLimit += Number(slot.dailyLimit || 0);
}

await fs.writeFile(reportPath, JSON.stringify({
  ...report,
  trendProvider: process.env.SERPAPI_API_KEY ? 'serpapi' : 'google-trends-api',
  trendProviderCounts,
  serpApiConfigured: Boolean(process.env.SERPAPI_API_KEY),
  serpApiUsage: { enabled: Boolean(process.env.SERPAPI_API_KEY), ...serpApiUsage },
  seoProvider: configuredGoogleSlots ? 'google-custom-search' : 'duckduckgo-html',
  seoProviderCounts,
  googleCseConfiguredSlots: configuredGoogleSlots,
  googleCseUsage: {
    enabled: configuredGoogleSlots > 0,
    configuredSlots: configuredGoogleSlots,
    day: googleCseUsage.day,
    totalDayUsed: googleDayUsed,
    totalDailyLimit: googleDailyLimit || configuredGoogleSlots * Number(process.env.GOOGLE_CSE_DAILY_LIMIT || 90),
    slots: googleCseUsage.slots || {},
    updatedAt: googleCseUsage.updatedAt || null,
  },
  braveSearchConfigured: false,
  braveSearchUsage: { enabled: false },
  siteTypeModelVersion: SITE_TYPE_MODEL_VERSION,
  siteTypeCounts: counts,
}, null, 2) + '\n');

console.log(`Site type classification complete: ${counts.online} online, ${counts.wiki} wiki, ${counts.pending} pending.`);
