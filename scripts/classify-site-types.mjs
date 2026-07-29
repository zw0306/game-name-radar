import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySiteType, SITE_TYPE_MODEL_VERSION } from '../lib/site-type.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const reportPath = path.join(root, 'data', 'latest-report.json');
const serpUsagePath = path.join(root, 'data', 'serpapi-usage.json');
const braveUsagePath = path.join(root, 'data', 'brave-search-usage.json');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
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
  enabled: Boolean(process.env.SERPAPI_API_KEY),
  monthUsed: 0,
  dayUsed: 0,
  monthlyLimit: Number(process.env.SERPAPI_MONTHLY_LIMIT || 220),
  dailyLimit: Number(process.env.SERPAPI_DAILY_LIMIT || 8),
});
const braveSearchUsage = await readJson(braveUsagePath, {
  enabled: Boolean(process.env.BRAVE_SEARCH_API_KEY),
  monthUsed: 0,
  dayUsed: 0,
  monthlyLimit: Number(process.env.BRAVE_SEARCH_MONTHLY_LIMIT || 900),
  dailyLimit: Number(process.env.BRAVE_SEARCH_DAILY_LIMIT || 30),
});
await fs.writeFile(reportPath, JSON.stringify({
  ...report,
  trendProvider: process.env.SERPAPI_API_KEY ? 'serpapi' : 'google-trends-api',
  trendProviderCounts,
  serpApiConfigured: Boolean(process.env.SERPAPI_API_KEY),
  serpApiUsage: { enabled: Boolean(process.env.SERPAPI_API_KEY), ...serpApiUsage },
  seoProvider: process.env.BRAVE_SEARCH_API_KEY ? 'brave-search-api' : 'duckduckgo-html',
  seoProviderCounts,
  braveSearchConfigured: Boolean(process.env.BRAVE_SEARCH_API_KEY),
  braveSearchUsage: { enabled: Boolean(process.env.BRAVE_SEARCH_API_KEY), ...braveSearchUsage },
  siteTypeModelVersion: SITE_TYPE_MODEL_VERSION,
  siteTypeCounts: counts,
}, null, 2) + '\n');

console.log(`Site type classification complete: ${counts.online} online, ${counts.wiki} wiki, ${counts.pending} pending.`);
