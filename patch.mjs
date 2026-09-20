import fs from 'fs/promises';

async function main() {
  // Patch index.html
  let html = await fs.readFile('index.html', 'utf8');
  // We don't need to inject embed_loader.js into <head> anymore since it's inside the iframe!
  html = html.replace(
    '<th>综合分</th><th>游戏名</th><th>建站类型／建议</th>',
    '<th>综合分</th><th>游戏名</th><th style="min-width:320px">实时热度对比</th><th>建站类型／建议</th>'
  );
  await fs.writeFile('index.html', html);

  // Patch app.js
  let app = await fs.readFile('app.js', 'utf8');
  
  // Remove geo=US
  app = app.replace(
    /&geo=US/g,
    ''
  );

  const observerCode = `if(window.embedObserver)window.embedObserver.disconnect();window.embedObserver=new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting){const d=e.target;window.embedObserver.unobserve(d);const q=d.dataset.game;const html=\`<!DOCTYPE html><html><head><script type="text/javascript" src="https://ssl.gstatic.com/trends_nrtr/4564_RC01/embed_loader.js"></script><style>body{margin:0;overflow:hidden;}</style></head><body><script type="text/javascript">trends.embed.renderExploreWidget("TIMESERIES", {"comparisonItem":[{"keyword":"\${q.replace(/"/g, '\\\\"')}", "geo":"","time":"now 7-d"},{"keyword":"unblur image","geo":"","time":"now 7-d"}],"category":0,"property":""}, {"exploreQuery":"date=now%207-d&q=\${encodeURIComponent(q)},unblur%20image","guestPath":"https://trends.google.com:443/trends/embed/"});</script></body></html>\`;const iframe=document.createElement('iframe');iframe.style.width='100%';iframe.style.height='100%';iframe.style.border='none';iframe.srcdoc=html;d.append(iframe);}}},{rootMargin:'300px'});`;
  
  app = app.replace(
    'function render(){renderStats();renderSources();',
    `function render(){${observerCode}renderStats();renderSources();`
  );

  const cellCode = `const embedTd=document.createElement('td');const embedDiv=document.createElement('div');embedDiv.style.width='320px';embedDiv.style.height='220px';embedDiv.style.overflow='hidden';embedDiv.style.position='relative';const scaleWrap=document.createElement('div');scaleWrap.style.transform='scale(0.8)';scaleWrap.style.transformOrigin='top left';scaleWrap.style.width='400px';scaleWrap.style.height='275px';scaleWrap.dataset.game=c.gameName;scaleWrap.className='trends-embed';embedDiv.append(scaleWrap);embedTd.append(embedDiv);if(window.embedObserver)window.embedObserver.observe(scaleWrap);`;

  app = app.replace(
    'tr.append(scoreTd,gameTd,adviceTd,seoTd,fastTd,trendTd,sourceTd,actions);',
    `${cellCode}tr.append(scoreTd,gameTd,embedTd,adviceTd,seoTd,fastTd,trendTd,sourceTd,actions);`
  );

  await fs.writeFile('app.js', app);
  console.log("Patched successfully");
}
main();
