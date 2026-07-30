import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'data', 'latest-report.json');
const statusPath = path.join(root, 'data', 'serpapi-account-status.json');
const TIMEOUT_MS = Math.max(5000, Number(process.env.SERPAPI_ACCOUNT_TIMEOUT_MS || 15000));

const slotDefinitions = [
  ['1', 'SERPAPI_API_KEY'],
  ['2', 'SERPAPI_API_KEY_2'],
  ['3', 'SERPAPI_API_KEY_3'],
  ['4', 'SERPAPI_API_KEY_4'],
  ['5', 'SERPAPI_API_KEY_5'],
];

async function readJson(file, fallback = {}) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
}

function accountFingerprint(accountId = '') {
  if (!accountId) return null;
  return crypto.createHash('sha256').update(String(accountId)).digest('hex').slice(0, 12);
}

async function inspectSlot(id, envName, key) {
  if (!key) return { id, envName, configured: false, ok: false, error: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = new URL('https://serpapi.com/account.json');
    url.searchParams.set('api_key', key);
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error || `SerpApi Account API returned ${response.status}`);
    return {
      id,
      envName,
      configured: true,
      ok: true,
      accountFingerprint: accountFingerprint(payload.account_id),
      accountStatus: payload.account_status || null,
      planId: payload.plan_id || null,
      planName: payload.plan_name || null,
      planMonthlyPrice: Number(payload.plan_monthly_price || 0),
      renewalDate: payload.plan_renewal_date || null,
      searchesPerMonth: Number(payload.searches_per_month || 0),
      thisMonthUsage: Number(payload.this_month_usage || 0),
      planSearchesLeft: Number(payload.plan_searches_left ?? payload.total_searches_left ?? 0),
      totalSearchesLeft: Number(payload.total_searches_left ?? payload.plan_searches_left ?? 0),
      rateLimitPerHour: Number(payload.account_rate_limit_per_hour || 0),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      id,
      envName,
      configured: true,
      ok: false,
      error: error?.name === 'AbortError' ? 'SerpApi Account API timed out' : String(error?.message || error),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

const slots = [];
for (const [id, envName] of slotDefinitions) {
  slots.push(await inspectSlot(id, envName, String(process.env[envName] || '').trim()));
}

const configured = slots.filter((slot) => slot.configured);
const working = configured.filter((slot) => slot.ok);
const fingerprints = new Map();
for (const slot of working) {
  const key = slot.accountFingerprint || `unknown-${slot.id}`;
  if (!fingerprints.has(key)) fingerprints.set(key, []);
  fingerprints.get(key).push(slot.id);
}

for (const slot of working) {
  const group = fingerprints.get(slot.accountFingerprint || `unknown-${slot.id}`) || [];
  slot.sharedAccount = group.length > 1;
  slot.sharedWithSlots = group.filter((id) => id !== slot.id);
}

const uniqueAccounts = [...fingerprints.entries()].map(([fingerprint, slotIds]) => {
  const representative = working.find((slot) => slot.accountFingerprint === fingerprint) || working.find((slot) => slot.id === slotIds[0]);
  return {
    accountFingerprint: fingerprint,
    slotIds,
    planName: representative?.planName || null,
    searchesPerMonth: representative?.searchesPerMonth || 0,
    thisMonthUsage: representative?.thisMonthUsage || 0,
    totalSearchesLeft: representative?.totalSearchesLeft || 0,
    renewalDate: representative?.renewalDate || null,
  };
});

const result = {
  checkedAt: new Date().toISOString(),
  accountApiConsumesSearchCredits: false,
  configuredKeys: configured.length,
  workingKeys: working.length,
  uniqueAccountCount: uniqueAccounts.length,
  duplicateKeyGroups: uniqueAccounts.filter((account) => account.slotIds.length > 1).map((account) => account.slotIds),
  totalIndependentSearchesLeft: uniqueAccounts.reduce((sum, account) => sum + Number(account.totalSearchesLeft || 0), 0),
  accounts: uniqueAccounts,
  slots,
};

await writeJson(statusPath, result);
const report = await readJson(reportPath, {});
await writeJson(reportPath, { ...report, serpApiAccountStatus: result });

for (const slot of configured) {
  if (!slot.ok) console.log(`SerpApi slot ${slot.id}: account check failed: ${slot.error}`);
  else console.log(`SerpApi slot ${slot.id}: ${slot.planName || slot.planId || 'unknown plan'}, ${slot.totalSearchesLeft} searches left${slot.sharedAccount ? `, shared with slot ${slot.sharedWithSlots.join(',')}` : ''}.`);
}
console.log(`SerpApi account inspection complete: ${configured.length} keys, ${uniqueAccounts.length} unique accounts, ${result.totalIndependentSearchesLeft} independent searches left.`);
