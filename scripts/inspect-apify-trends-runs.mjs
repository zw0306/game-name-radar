import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'data', 'apify-trends-runs.json');
const token = process.env.APIFY_API_TOKEN || '';
const actorId = process.env.APIFY_TRENDS_ACTOR_ID || 'apify~google-trends-scraper';

async function api(pathname, accept = 'application/json') {
  const response = await fetch(`https://api.apify.com/v2${pathname}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Apify ${pathname} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  if (accept === 'text/plain') return text;
  return JSON.parse(text);
}

function safeRun(run) {
  return {
    id: run.id,
    status: run.status,
    statusMessage: run.statusMessage || null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    exitCode: run.exitCode,
    defaultDatasetId: run.defaultDatasetId,
    usageUsd: run.usageUsd ?? null,
    usageTotalUsd: run.usageTotalUsd ?? null,
    pricingInfo: run.pricingInfo || null,
    stats: run.stats || null,
    buildNumber: run.buildNumber || null,
  };
}

let report = { checkedAt: new Date().toISOString(), configured: Boolean(token), actorId, ok: false, runs: [] };
try {
  if (!token) throw new Error('APIFY_API_TOKEN is not configured');
  const list = await api(`/actors/${actorId}/runs?limit=5&desc=1`);
  const runs = list?.data?.items || [];
  for (const run of runs.slice(0, 3)) {
    let log = '';
    try { log = await api(`/logs/${run.id}`, 'text/plain'); } catch (error) { log = `Log unavailable: ${error.message}`; }
    let datasetItems = [];
    try {
      const dataset = await api(`/datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=2`);
      datasetItems = Array.isArray(dataset) ? dataset : [];
    } catch {}
    report.runs.push({
      ...safeRun(run),
      datasetItemCountSampled: datasetItems.length,
      logTail: log.split('\n').slice(-120).join('\n').slice(-12000),
    });
  }
  report.ok = true;
} catch (error) {
  report.error = String(error?.message || error);
}

await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(`Apify Trends run inspection complete: ${report.runs.length} run(s), ok=${report.ok}.`);
