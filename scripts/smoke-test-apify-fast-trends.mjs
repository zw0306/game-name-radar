import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'data', 'apify-fast-trends-smoke.json');
const token = process.env.APIFY_API_TOKEN || '';
const actorId = process.env.APIFY_FAST_TRENDS_ACTOR_ID || 'data_xplorer~google-trends-fast-scraper';

async function readExisting() {
  try { return JSON.parse(await fs.readFile(outputPath, 'utf8')); } catch { return null; }
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|authorization|cookie|secret/i.test(key)) out[key] = '[redacted]';
    else out[key] = sanitize(item);
  }
  return out;
}

const existing = await readExisting();
if (existing?.ok && Number(existing?.itemCount || 0) > 0 && existing?.actorId === actorId) {
  console.log('Lightweight Apify Trends smoke test already passed; skipping.');
  process.exit(0);
}

if (!token) {
  await fs.writeFile(outputPath, JSON.stringify({ checkedAt: new Date().toISOString(), configured: false, ok: false, actorId, error: 'APIFY_API_TOKEN is not configured' }, null, 2) + '\n');
  process.exit(0);
}

const input = {
  mode: 'keyword',
  enableTrendingSearches: false,
  keyword: 'Shift At Midnight',
  predefinedTimeframe: 'today 3-m',
  geo: 'US',
  fetchRegionalData: false,
  proxyConfiguration: { useApifyProxy: true },
};

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 3 * 60 * 1000);
let result;
try {
  const params = new URLSearchParams({ clean: 'true', format: 'json', timeout: '150', maxTotalChargeUsd: '0.05' });
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?${params}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: controller.signal,
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = text.slice(0, 3000); }
  if (!response.ok) throw new Error(typeof payload === 'string' ? payload : payload?.error?.message || payload?.message || `Apify returned HTTP ${response.status}`);
  const items = Array.isArray(payload) ? payload : [payload];
  result = {
    checkedAt: new Date().toISOString(),
    configured: true,
    ok: items.length > 0 && items.some((item) => item?.timeline_data && typeof item.timeline_data === 'object'),
    actorId,
    input,
    itemCount: items.length,
    sample: sanitize(items.slice(0, 2)),
  };
  if (!result.ok) result.error = 'Actor returned no usable timeline_data';
  console.log(`Lightweight Apify Trends smoke test: ${items.length} item(s), usable=${result.ok}.`);
} catch (error) {
  result = {
    checkedAt: new Date().toISOString(),
    configured: true,
    ok: false,
    actorId,
    error: error?.name === 'AbortError' ? 'Apify lightweight Trends smoke test timed out' : String(error?.message || error),
  };
  console.error(result.error);
} finally {
  clearTimeout(timer);
}

await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
