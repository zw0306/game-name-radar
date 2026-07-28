import { scanSource } from '../lib/scanner.mjs';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持 POST 请求' });
  }

  const sources = Array.isArray(req.body?.sources) ? req.body.sources : [];
  if (!sources.length) return res.status(400).json({ error: '请至少提供一个监控源' });
  if (sources.length > 20) return res.status(400).json({ error: '单次最多扫描 20 个监控源' });

  const normalized = sources.map((source, index) => ({
    id: String(source.id || `source-${index}`),
    name: String(source.name || `Source ${index + 1}`).slice(0, 80),
    url: String(source.url || '').trim(),
    kind: String(source.kind || 'auto'),
  })).filter((source) => source.url);

  const results = [];
  for (let index = 0; index < normalized.length; index += 4) {
    const chunk = normalized.slice(index, index + 4);
    const settled = await Promise.allSettled(chunk.map((source) => scanSource(source)));
    settled.forEach((item, itemIndex) => {
      const source = chunk[itemIndex];
      if (item.status === 'fulfilled') {
        results.push({ ok: true, ...item.value });
      } else {
        results.push({
          ok: false,
          sourceId: source.id,
          sourceName: source.name,
          sourceUrl: source.url,
          error: item.reason?.message || '扫描失败',
          entries: [],
          scannedAt: new Date().toISOString(),
        });
      }
    });
  }

  return res.status(200).json({ results, scannedAt: new Date().toISOString() });
}
