import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.SERPAPI_API_KEY) {
  console.log('SERPAPI_API_KEY is not configured; keeping existing trend results.');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');

let payload;
try {
  payload = JSON.parse(await fs.readFile(candidatesPath, 'utf8'));
} catch {
  console.log('No candidate data found.');
  process.exit(0);
}

const candidates = Array.isArray(payload) ? payload : payload.candidates || [];
let reset = 0;
for (const candidate of candidates) {
  if (candidate.trend && candidate.trend.provider !== 'serpapi') {
    delete candidate.trend;
    candidate.recommendation = 'pending';
    candidate.level = 'pending';
    candidate.finalScore = 0;
    candidate.score = 0;
    reset += 1;
  }
}

if (reset > 0) {
  const output = Array.isArray(payload) ? candidates : { ...payload, candidates };
  await fs.writeFile(candidatesPath, JSON.stringify(output, null, 2) + '\n');
}
console.log(`Reset ${reset} legacy trend result(s) for SerpApi migration.`);
