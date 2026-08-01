import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file used to delete every non-SerpApi trend result on each workflow run.
// That made valid SearchApi results disappear and caused validated/recommended
// counts to move backwards. Provider migrations must be non-destructive.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');

let payload;
try {
  payload = JSON.parse(await fs.readFile(candidatesPath, 'utf8'));
} catch {
  console.log('No candidate data found; trend preservation check skipped.');
  process.exit(0);
}

const candidates = Array.isArray(payload) ? payload : payload.candidates || [];
const providerCounts = {};
let preserved = 0;

for (const candidate of candidates) {
  const trend = candidate.trend;
  if (!trend) continue;
  const provider = trend.provider || 'unknown';
  providerCounts[provider] = (providerCounts[provider] || 0) + 1;
  preserved += 1;
}

console.log(`Preserved ${preserved} existing trend result(s): ${JSON.stringify(providerCounts)}.`);
