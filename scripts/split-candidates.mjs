/**
 * split-candidates.mjs
 * 将 candidates.json 拆分为：
 *   data/candidates-recent.json   — 最近 7 天（默认加载）
 *   data/candidates-YYYY-MM.json  — 按月归档（按需加载）
 *   data/candidates-index.json    — 索引，列出所有可用归档月份及条数
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');

const RECENT_DAYS = 7;

async function main() {
  const raw = await fs.readFile(path.join(dataDir, 'candidates.json'), 'utf-8');
  const parsed = JSON.parse(raw);
  const all = Array.isArray(parsed) ? parsed : parsed.candidates || [];

  const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 3600 * 1000);
  const recentItems = [];
  const byMonth = {};   // { 'YYYY-MM': [...] }

  for (const c of all) {
    const d = c.firstSeen ? new Date(c.firstSeen) : null;
    if (d && d >= cutoff) {
      recentItems.push(c);
    } else {
      const key = d ? d.toISOString().slice(0, 7) : 'unknown';
      (byMonth[key] = byMonth[key] || []).push(c);
    }
  }

  // 写最近7天
  await fs.writeFile(
    path.join(dataDir, 'candidates-recent.json'),
    JSON.stringify(recentItems, null, 2) + '\n'
  );
  console.log(`[split] recent (${RECENT_DAYS}d): ${recentItems.length} items`);

  // 按月写归档
  const archiveIndex = [];
  for (const [month, items] of Object.entries(byMonth).sort()) {
    const filename = `candidates-${month}.json`;
    await fs.writeFile(
      path.join(dataDir, filename),
      JSON.stringify(items, null, 2) + '\n'
    );
    archiveIndex.push({ month, count: items.length, file: `data/${filename}` });
    console.log(`[split] archive ${month}: ${items.length} items`);
  }

  // 写索引
  await fs.writeFile(
    path.join(dataDir, 'candidates-index.json'),
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      recentDays: RECENT_DAYS,
      recentCount: recentItems.length,
      archives: archiveIndex,
    }, null, 2) + '\n'
  );

  console.log(`[split] done. archives: ${archiveIndex.length} months`);
}

main().catch(e => { console.error(e); process.exit(1); });
