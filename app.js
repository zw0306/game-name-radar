const RAW_BASE='https://raw.githubusercontent.com/foxigaoqian/game-name-radar/main';
const DATA_URL=`${RAW_BASE}/data/candidates.json`;
const REPORT_URL=`${RAW_BASE}/data/latest-report.json`;
const STATUS_KEY='gameRadar.resultStatus.v3';
const els={lastUpdated:document.querySelector('#lastUpdated'),verifyStatus:document.querySelector('#verifyStatus'),sourceCount:document.querySelector('#sourceCount'),newCount:document.querySelector('#newCount'),independentCount:document.querySelector('#independentCount'),pageCount:document.querySelector('#pageCount'),sourceChips:document.querySelector('#sourceChips'),body:document.querySelector('#resultBody'),empty:document.querySelector('#emptyState'),search:document.querySelector('#searchInput'),recommendation:document.querySelector('#recommendationFilter'),time:document.querySelector('#timeFilter'),refresh:document.querySelector('#refreshBtn'),export:document.querySelector('#exportBtn'),toast:document.querySelector('#toast')};
let candidates=[];let report={};let statuses=loadStatuses();
const LABELS={independent:'适合独立站',page:'仅适合站内页',watch:'观察中',reject:'不建议做',pending:'等待验证',error:'验证失败'};
function loadStatuses(){try{return JSON.parse(localStorage.getItem(STATUS_KEY)||'{}')}catch{return{}}}
function saveStatuses(){localStorage.setItem(STATUS_KEY,JSON.stringify(statuses))}
function toast(text){els.toast.textContent=text;els.toast.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove('show'),2400)}
function fmtDate(value){if(!value)return'—';const d=new Date(value);if(Number.isNaN(d.getTime()))return value;return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d)}
function ageDays(value){const t=Date.parse(value||'');return Number.isFinite(t)?(Date.now()-t)/86400000:Infinity}
function normalize(value=''){return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim()}
function classification(c){return c.seo?.classification||'pending'}
function seoScore(c){return Number.isFinite(c.seo?.score)?c.seo.score:0}
function trends(name,days){return`https://trends.google.com/trends/explore?date=${encodeURIComponent(days===7?'now 7-d':'today 1-m')}&geo=US&q=${encodeURIComponent(name)}`}
function serp(name){return`https://www.google.com/search?q=${encodeURIComponent(`"${name}" game play online`)}`}
function domain(name){return`https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(normalize(name).replaceAll(' ',''))}`}
function filtered(){
  const q=els.search.value.trim().toLowerCase(),filter=els.recommendation.value,days=els.time.value==='all'?Infinity:Number(els.time.value);
  return candidates.filter(c=>{
    const cls=classification(c);
    if(filter==='recommended'&&!['independent','page'].includes(cls))return false;
    if(!['all','recommended'].includes(filter)&&cls!==filter)return false;
    if(ageDays(c.firstSeen)>days)return false;
    if(q&&!c.gameName.toLowerCase().includes(q)&&!(c.sources||[]).some(s=>s.name.toLowerCase().includes(q)))return false;
    return statuses[c.id]!=='ignored';
  }).sort((a,b)=>seoScore(b)-seoScore(a)||(b.discoveryScore||0)-(a.discoveryScore||0)||Date.parse(b.firstSeen)-Date.parse(a.firstSeen));
}
function renderStats(){
  const active=candidates.filter(c=>statuses[c.id]!=='ignored');
  els.sourceCount.textContent=String(report.sources?.length||0);
  els.newCount.textContent=String(report.totalAdded||0);
  els.independentCount.textContent=String(active.filter(c=>classification(c)==='independent').length);
  els.pageCount.textContent=String(active.filter(c=>classification(c)==='page').length);
  els.lastUpdated.textContent=report.scannedAt?fmtDate(report.scannedAt):'尚无扫描结果';
  els.verifyStatus.textContent=`本轮SEO验证 ${report.seoVerified||0} 个，失败 ${report.seoErrors||0} 个`;
}
function renderSources(){
  const logs=report.sources||[];els.sourceChips.innerHTML='';
  if(!logs.length){els.sourceChips.innerHTML='<span class="muted">等待后台第一次自动扫描。</span>';return}
  for(const log of logs){const chip=document.createElement('span');chip.className=`source-chip ${log.ok?'':'error'}`;const name=document.createElement('b');name.textContent=log.sourceName||log.sourceId;const detail=document.createElement('small');detail.textContent=log.ok?`${log.total||0}项 · 新增${log.added||0}`:log.error||'失败';chip.append(name,detail);els.sourceChips.append(chip)}
}
function action(label,href){const a=document.createElement('a');a.className='action';a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;return a}
function reasonText(c){
  const seo=c.seo||{};const reasons=(seo.reasons||[]).slice(0,3);
  const metrics=[];
  if(Number.isFinite(seo.exactGameRatio))metrics.push(`主词游戏${Math.round(seo.exactGameRatio*100)}%`);
  if(Number.isFinite(seo.exactNewsRatio)&&seo.exactNewsRatio>0)metrics.push(`新闻${Math.round(seo.exactNewsRatio*100)}%`);
  if(seo.suggestionGameCount)metrics.push(`补全${seo.suggestionGameCount}个`);
  return {reasons,metrics};
}
function render(){
  renderStats();renderSources();const list=filtered();els.body.textContent='';els.empty.hidden=list.length>0;
  for(const c of list.slice(0,500)){
    const cls=classification(c),seo=c.seo||{},tr=document.createElement('tr');
    const scoreTd=document.createElement('td'),score=document.createElement('span');score.className=`score ${cls}`;score.textContent=cls==='pending'?'—':seoScore(c);scoreTd.append(score);
    const gameTd=document.createElement('td'),title=document.createElement('strong'),url=document.createElement('a'),discovery=document.createElement('span');title.className='game-title';title.textContent=c.gameName;url.className='game-url';url.href=c.sources?.[0]?.url||'#';url.target='_blank';url.rel='noopener noreferrer';url.textContent=c.sources?.[0]?.url||'';discovery.className='game-meta';discovery.textContent=`发现分 ${c.discoveryScore??'—'} · ${c.sources?.length||0}个来源`;gameTd.append(title,url,discovery);
    const adviceTd=document.createElement('td'),advice=document.createElement('span');advice.className=`recommendation ${cls}`;advice.textContent=LABELS[cls]||cls;adviceTd.append(advice);
    const judgeTd=document.createElement('td'),judge=document.createElement('div');judge.className='judgement';const info=reasonText(c);for(const text of info.reasons){const p=document.createElement('span');p.textContent=text;judge.append(p)}if(info.metrics.length){const small=document.createElement('small');small.textContent=info.metrics.join(' · ');judge.append(small)}judgeTd.append(judge);
    const sourceTd=document.createElement('td'),chips=document.createElement('div');chips.className='chips';for(const s of c.sources||[]){const chip=document.createElement('span');chip.className='chip';chip.textContent=s.name;chips.append(chip)}sourceTd.append(chips);
    const first=document.createElement('td');first.textContent=fmtDate(c.firstSeen);
    const actions=document.createElement('td'),wrap=document.createElement('div');wrap.className='actions';wrap.append(action('Trends 7天',trends(c.gameName,7)),action('30天',trends(c.gameName,30)),action('SERP',serp(c.gameName)));if(cls==='independent')wrap.append(action('域名',domain(c.gameName)));const copy=document.createElement('button');copy.className='action';copy.textContent='复制';copy.onclick=async()=>{await navigator.clipboard.writeText(c.gameName);toast('已复制游戏名')};const ignore=document.createElement('button');ignore.className='action';ignore.textContent='忽略';ignore.onclick=()=>{statuses[c.id]='ignored';saveStatuses();render();toast('已隐藏')};wrap.append(copy,ignore);actions.append(wrap);
    tr.append(scoreTd,gameTd,adviceTd,judgeTd,sourceTd,first,actions);els.body.append(tr);
  }
}
async function load(){els.refresh.disabled=true;try{const stamp=Date.now();const [cRes,rRes]=await Promise.all([fetch(`${DATA_URL}?v=${stamp}`,{cache:'no-store'}),fetch(`${REPORT_URL}?v=${stamp}`,{cache:'no-store'})]);if(!cRes.ok)throw new Error('候选数据读取失败');const cJson=await cRes.json();candidates=Array.isArray(cJson)?cJson:cJson.candidates||[];report=rRes.ok?await rRes.json():{};render()}catch(e){toast(e.message);render()}finally{els.refresh.disabled=false}}
els.search.addEventListener('input',render);els.recommendation.addEventListener('change',render);els.time.addEventListener('change',render);els.refresh.addEventListener('click',()=>load().then(()=>toast('结果已刷新')));els.export.addEventListener('click',()=>{const rows=[['Game Name','SEO Score','Recommendation','Discovery Score','First Seen','Reasons','Sources','URL'],...filtered().map(c=>[c.gameName,seoScore(c),LABELS[classification(c)]||classification(c),c.discoveryScore||0,c.firstSeen,(c.seo?.reasons||[]).join(' | '),(c.sources||[]).map(s=>s.name).join(' | '),c.sources?.[0]?.url||''])];const csv='\ufeff'+rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`game-seo-results-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href)});
load();setInterval(load,5*60*1000);
