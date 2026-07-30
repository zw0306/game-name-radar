import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'data', 'apify-fallback-preflight.json');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120000 });
  return {
    command: [command, ...args].join(' '),
    status: result.status,
    signal: result.signal || null,
    ok: result.status === 0,
    stdout: String(result.stdout || '').slice(-8000),
    stderr: String(result.stderr || '').slice(-8000),
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

const checks = [
  run(process.execPath, ['--check', 'lib/apify-fast-trends.mjs']),
  run(process.execPath, ['--check', 'lib/opportunity-finalizer.mjs']),
  run(process.execPath, ['--check', 'scripts/fill-apify-trends.mjs']),
  run(process.execPath, ['--test', 'tests/apify-fast-trends.test.mjs']),
];

const report = {
  checkedAt: new Date().toISOString(),
  ok: checks.every((check) => check.ok),
  checks,
};
await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(`Apify fallback preflight complete: ok=${report.ok}.`);
