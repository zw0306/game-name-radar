export const SITE_TYPE_MODEL_VERSION = 1;

const ONLINE_SOURCE_IDS = new Set([
  'itch-newest-web',
  'itch-new-popular-web',
  'itch-jam-newest-html5',
  'itch-jam-popular-html5',
  'newgrounds-daily-top',
  'newgrounds-latest',
  'crazygames-new',
  'poki-new',
  'y8-new',
  'gamepix-new',
  'lagged-new',
]);

const ONLINE_KINDS = new Set([
  'itch-popular',
  'itch-jam-new',
  'itch-jam-popular',
  'newgrounds-top',
  'newgrounds-new',
  'crazygames-new',
  'poki-new',
  'y8-new',
  'gamepix-new',
  'lagged-new',
]);

const WIKI_SOURCE_IDS = new Set(['steam-popular-new', 'steam-latest-indie']);
const WIKI_KINDS = new Set(['steam-popular-new', 'steam-new']);

function hostname(value = '') {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function classifySiteType(candidate = {}) {
  const sources = candidate.sources || [];
  const onlineSources = sources.filter((source) =>
    ONLINE_SOURCE_IDS.has(source.sourceId) ||
    ONLINE_KINDS.has(source.kind) ||
    ['crazygames.com', 'poki.com', 'y8.com', 'gamepix.com', 'lagged.com', 'newgrounds.com'].some((domain) => hostname(source.url).endsWith(domain)),
  );
  const wikiSources = sources.filter((source) =>
    WIKI_SOURCE_IDS.has(source.sourceId) ||
    WIKI_KINDS.has(source.kind) ||
    ['store.steampowered.com', 'xbox.com', 'playstation.com', 'epicgames.com'].some((domain) => hostname(source.url).endsWith(domain)),
  );

  let type = 'pending';
  let confidence = 'low';
  let browserPlayable = null;
  let iframeLikely = null;
  const reasons = [];

  if (onlineSources.length) {
    type = 'online';
    confidence = onlineSources.length >= 2 ? 'high' : 'medium';
    browserPlayable = true;
    iframeLikely = true;
    reasons.push(`已在${onlineSources.length}个浏览器游戏平台或HTML5榜单出现`);
    if (wikiSources.length) reasons.push('同时存在Steam/下载版本，但已有浏览器可玩证据');
  } else if (wikiSources.length) {
    type = 'wiki';
    confidence = 'high';
    browserPlayable = false;
    iframeLikely = false;
    reasons.push('已发现Steam或下载型游戏来源，未发现浏览器直接可玩版本');
    if ((candidate.youtube?.videoCount || 0) >= 5) reasons.push('YouTube内容生态适合攻略、Wiki和教程站');
  } else {
    reasons.push('当前来源不足以确认是HTML5在线游戏还是下载型游戏');
  }

  return {
    modelVersion: SITE_TYPE_MODEL_VERSION,
    checkedAt: new Date().toISOString(),
    type,
    confidence,
    browserPlayable,
    iframeLikely,
    onlineSourceCount: onlineSources.length,
    wikiSourceCount: wikiSources.length,
    reasons,
  };
}

export function siteTypeLabel(type) {
  return { online: '在线游戏型', wiki: 'Wiki攻略型', pending: '类型待确认' }[type] || '类型待确认';
}
