import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource, normalizeGameName, calculateCandidateScore, candidateLevel } from '../lib/scanner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcesPath = path.join(root, 'config', 'sources.json');
const statePath = path.join(root, 'data', 'state.json');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const reportPath = path.join(root, 'data', 'latest-report.json');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function mergeCandidate(candidates, gameName, source, entry, now) {
  const normalizedName = normalizeGameName(gameName);
  if (!normalizedName || normalizedName.length < 2) return false;

  let candidate = candidates.find((item) => item.normalizedName === normalizedName);
  if (!candidate) {
    candidate = {
      id: `auto-${Buffer.from(normalizedName).toString('base64url').slice(0, 24)}`,
      gameName,
      normalizedName,
      firstSeen: now,
      lastSeen: now,
      status: 'new',
      sources: [],
    };
    candidates.push(candidate);
  }

  const key = `${source.id}|${entry.url}`;
  if (!candidate.sources.some((item) => item.key === key)) {
    candidate.sources.push({
      key,
      sourceId: source.id,
      name: source.name,
      kind: source.kind,
      url: entry.url,
      date: entry.date || '',
    });
  }
  candidate.lastSeen = now;
  candidate.score = calculateCandidateScore(candidate);
  candidate.level = candidateLevel(candidate.score);
  return true;
}

const sources = (await readJson(sourcesPath, [])).filter((source) => source.enabled !== false);
const radarState = await readJson(statePath, { snapshots: {}, lastScan: null });
const candidatePayload = await readJson(candidatesPath, { candidates: [] });
const candidates = Array.isArray(candidatePayload) ? candidatePayload : candidatePayload.candidates || [];
const now = new Date().toISOString();
const logs = [];
let totalAdded = 0;

for (const source of sources) {
  try {
    const result = await scanSource({
      ...source,
      kind: source.fetchKind || (source.kind?.includes('sitemap') ? 'sitemap' : source.kind?.includes('itch') ? 'itch-listing' : source.kind || 'auto'),
    });
    const previous = radarState.snapshots[source.id];
    const previousUrls = new Set(previous?.urls || []);
    const firstScan = !previous;
    const newEntries = firstScan && source.baselineOnly
      ? []
      : result.entries.filter((entry) => !previousUrls.has(entry.url));

    let added = 0;
    for (const entry of newEntries) {
      if (mergeCandidate(candidates, entry.gameName, source, entry, now)) added += 1;
    }
    totalAdded += added;

    radarState.snapshots[source.id] = {
      urls: result.entries.map((entry) => entry.url),
      scannedAt: result.scannedAt,
      detectedType: result.detectedType,
    };
    logs.push({ ok: true, sourceId: source.id, sourceName: source.name, total: result.entries.length, added });
    console.log(`✓ ${source.name}: ${result.entries.length} entries, ${added} new`);
  } catch (error) {
    logs.push({ ok: false, sourceId: source.id, sourceName: source.name, error: error.message });
    console.error(`✗ ${source.name}: ${error.message}`);
  }
}

for (const candidate of candidates) {
  candidate.score = calculateCandidateScore(candidate);
  candidate.level = candidateLevel(candidate.score);
}
candidates.sort((a, b) => (b.score || 0) - (a.score || 0) || Date.parse(b.firstSeen) - Date.parse(a.firstSeen));

radarState.lastScan = now;
await fs.writeFile(statePath, JSON.stringify(radarState, null, 2) + '\n');
await fs.writeFile(candidatesPath, JSON.stringify({ updatedAt: now, candidates }, null, 2) + '\n');
await fs.writeFile(reportPath, JSON.stringify({ scannedAt: now, totalAdded, sources: logs }, null, 2) + '\n');

console.log(`Scan complete. ${totalAdded} candidate names added.`);
