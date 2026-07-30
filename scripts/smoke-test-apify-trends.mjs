import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'data', 'apify-trends-smoke.json');
const token = process.env.APIFY_API_TOKEN || '';
const actorId = process.env.APIFY_TRENDS_ACTOR_ID || 'apify~google-trends-scraper';

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
if (existing?.ok && existing?.actorId === actorId) {
  console.log('Apify Trends smoke test already completed; skipping.');
  process.exit(0);
}

if (!token) {
  await fs.writeFile(outputPath, JSON.stringify({ checkedAt: new Date().toISOString(), configured: false, ok: false, actorId, error: 'APIFY_API_TOKEN is not configured' }, null, 2) + '\n');
  console.log('APIFY_API_TOKEN is not configured; smoke test skipped.');
  process.exit(0);
}

const input = {
  searchTerms: ['Shift At Midnight,Shift At Midnight wiki,Shift At Midnight guide,steam'],
  isMultiple: true,
  timeRange: 'today 3-m',
  geo: 'US',
  viewedFrom: 'us',
  category: '',
  maxItems: 1,
  maxConcurrency: 1,
  maxRequestRetries: 2,
  pageLoadTimeoutSecs: 90,
  skipDebugScreen: true,
};

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 8 * 60 * 1000);
let result;
try {
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?clean=true&format=json&timeout=420`;
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
    ok: true,
    actorId,
    input: { ...input, searchTerms: input.searchTerms },
    itemCount: items.length,
    sample: sanitize(items.slice(0, 2)),
  };
  console.log(`Apify Trends smoke test completed with ${items.length} dataset item(s).`);
} catch (error) {
  result = {
    checkedAt: new Date().toISOString(),
    configured: true,
    ok: false,
    actorId,
    error: error?.name === 'AbortError' ? 'Apify Trends smoke test timed out' : String(error?.message || error),
  };
  console.error(result.error);
} finally {
  clearTimeout(timer);
}

await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
