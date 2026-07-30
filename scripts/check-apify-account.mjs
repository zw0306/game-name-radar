import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'data', 'apify-account-status.json');
const token = String(process.env.APIFY_API_TOKEN || '').trim();

function fingerprint(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}

const result = {
  checkedAt: new Date().toISOString(),
  configured: Boolean(token),
  ok: false,
  provider: 'apify',
  accountApiConsumesActorCredits: false,
};

if (!token) {
  result.error = 'APIFY_API_TOKEN is not configured';
} else {
  try {
    const response = await fetch('https://api.apify.com/v2/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Apify returned HTTP ${response.status}`);
    const user = payload?.data || {};
    result.ok = true;
    result.accountFingerprint = fingerprint(user.id || user.username);
    result.username = user.username || null;
    result.plan = user.plan ? {
      id: user.plan.id || user.plan.planId || null,
      name: user.plan.name || user.plan.planName || null,
      monthlyUsageCreditsUsd: user.plan.monthlyUsageCreditsUsd ?? null,
      monthlyUsageCredits: user.plan.monthlyUsageCredits ?? null,
    } : null;
  } catch (error) {
    result.error = String(error?.message || error).slice(0, 300);
  }
}

await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(result.ok ? `Apify token valid (${result.username || result.accountFingerprint}).` : `Apify token check failed: ${result.error}`);
