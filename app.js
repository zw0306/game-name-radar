const RAW_BASE='https://raw.githubusercontent.com/foxigaoqian/game-name-radar/main';
const DATA_URL=`${RAW_BASE}/data/candidates.json`;
const REPORT_URL=`${RAW_BASE}/data/latest-report.json`;
const STATUS_KEY='gameRadar.resultStatus.v6';
const els={lastUpdated:document.querySelector('#lastUpdated'),verifyStatus:document.querySelector('#verifyStatus'),sourceCount:document.querySelector('#sourceCount'),newCount:document.querySelector('#newCount'),independentCount:document.querySelector('#independentCount'),pendingCount:document.querySelector('#pendingCount'),sourceChips:document.querySelector('#sourceChips'),body:document.querySelector('#resultBody'),empty:document.querySelector('#emptyState'),emptyDetail:document.querySelector('#emptyDetail'),search:document.querySelector('#searchInput'),recommendation:document.querySelector('#recommendationFilter'),time:document.querySelector('#timeFilter'),refresh:document.querySelector('#refreshBtn'),export:document.querySelector('#exportBtn'),toast:document.querySelector('#toast')};
let candidates=[];let report={};let statuses=loadStatuses();
const LABELS={independent:'明显上涨·适合独立站',page:'稳定需求·站内页',watch:'趋势较弱',reject:'不建议做',pending:'等待验证',error:'验证失败'};
const TREND_LABELS={breakout:'Breakout爆发',rising:'明显上涨',strong:'需求较强但未上涨',moderate:'需求中等',weak:'需求较弱',none:'无可见需求',pending:'等待趋势验证',error:'趋势验证失败'};
const TREND_RANK={breakout:6,rising:5,strong:4,moderate:3,weak:2,none:1,pending:0,error:0};
const FRESHNESS_LABELS={new:'新关键词',existing:'历史旧词',unknown:'历史待确认'};
function loadStatuses(){try{return JSON.parse(localStorage.getItem(STATUS_KEY)||'{}')}catch{return{}}}
function saveStatuses(){localStorage.setItem(STATUS_KEY,JSON.stringify(statuses))}
function toast(text){els.toast.textContent=text;els.toast.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove('show'),2400)}
function fmtDate(value){if(!value)return'—';const d=new Date(value);if(Number.isNaN(d.getTime()))return value;return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d)}
function ageDays(value){const t=Date.parse(value||'');return Number.isFinite(t)?(Date.now()-t)/86400000:Infinity}
function normalize(value=''){return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim()}
function classification(c){return c.recommendation||c.level||'pending'}
function finalScore(c){return Number.isFinite(c.finalScore)?c.finalScore:Number.isFinite(c.score)?c.score:0}
function seoScore(c){return Number.isFinite(c.seo?.score)?c.seo.score:0}
function trendScore(c){return Number.isFinite(c.trend?.score)?c.trend.score:0}
function isPriorityTrendPending(c){return ['independent','page'].includes(c.seo?.classification)&&Number(c.seo?.score||0)>=42&&Number(c.seo?.nameRisk??30)<=14&&['pending','error',undefined].includes(c.trend?.classification)}
function trends(name,days){return`https://trends.google.com/trends/explore?date=${encodeURIComponent(days===7?'now 7-d':'today 1-m')}&geo=US&q=${encodeURIComponent(name)}`}
function serp(name){return`https://www.google.com/search?q=${encodeURIComponent(`"${name}" game play online`)}`}
function domain(name){return`https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(normalize(name).replaceAll(' ',''))}`}
function filtered(){
  const q=els.search.value.trim().toLowerCase(),filter=els.recommendation.value,days=els.time.value==='all'?Infinity:Number(els.time.value);
  return candidates.filter(c=>{
    const cls=classification(c);
    if(filter==='recommended'&&cls!=='independent')return false;
    if(filter==='trend-pending'&&!isPriorityTrendPending(c))return false;
    if(!['all','recommended','trend-pending'].includes(filter)&&cls!==filter)return false;
    if(ageDays(c.firstSeen)>days)return false;
    if(q&&!c.gameName.toLowerCase().includes(q)&&!(c.sources||[]).some(s=>s.name.toLowerCase().includes(q)))return false;
    return statuses[c.id]!=='ignored';
  }).sort((a,b)=>(TREND_RANK[b.trend?.classification]||0)-(TREND_RANK[a.trend?.classification]||0)||finalScore(b)-finalScore(a)||trendScore(b)-trendScore(a)||seoScore(b)-seoScore(a)||(b.discoveryScore||0)-(a.discoveryScore||0)||Date.parse(b.firstSeen)-Date.parse(a.firstSeen));
}
function renderStats(){
  const active=candidates.filter(c=>statuses[c.id]!=='ignored');
  els.sourceCount.textContent=String(report.sources?.length||0);
  els.newCount.textContent=String(report.totalAdded||0);
  els.independentCount.textContent=String(active.filter(c=>classification(c)==='independent').length);
  els.pendingCount.textContent=String(report.trendPendingCount??active.filter(isPriorityTrendPending).length);
  els.lastUpdated.textContent=report.scannedAt?fmtDate(report.scannedAt):'尚无扫描结果';
  els.verifyStatus.textContent=`SEO通过 ${report.seoPassedCount||0} · 趋势已验 ${report.trendValidatedCount||0} · 待验 ${report.trendPendingCount||0}`;
  if(els.emptyDetail)els.emptyDetail.textContent=(report.trendPendingCount||0)>0?`后台还有 ${report.trendPendingCount} 个高质量候选等待趋势验证，可切换到“优先趋势验证队列”查看。`:'当前候选均未达到上涨与新词门槛，后台会继续扫描新数据。';
}
function renderSources(){
  const logs=report.sources||[];els.sourceChips.innerHTML='';
  if(!logs.length){els.sourceChips.innerHTML='<span class="muted">等待后台第一次自动扫描。</span>';return}
  for(const log of logs){const chip=document.createElement('span');chip.className=`source-chip ${log.ok?'':'error'}`;const name=document.createElement('b');name.textContent=log.sourceName||log.sourceId;const detail=document.createElement('small');detail.textContent=log.ok?`${log.total||0}项 · 新增${log.added||0}`:log.error||'失败';chip.append(name,detail);els.sourceChips.append(chip)}
}
function action(label,href){const a=document.createElement('a');a.className='action';a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;return a}
function renderSeo(c){
  const seo=c.seo||{};const box=document.createElement('div');box.className='judgement';
  const label=document.createElement('span');label.textContent=`SEO意图分 ${seoScore(c)}`;box.append(label);
  const reasons=(seo.reasons||[]).filter(text=>!text.startsWith('适合')&&!text.startsWith('不建议')).slice(0,2);
  for(const text of reasons){const p=document.createElement('small');p.textContent=text;box.append(p)}
  if(Number.isFinite(seo.exactGameRatio)){const metrics=document.createElement('small');metrics.textContent=`主词游戏 ${Math.round(seo.exactGameRatio*100)}%${seo.exactNewsRatio>0?` · 新闻 ${Math.round(seo.exactNewsRatio*100)}%`:''} · 歧义风险 ${seo.nameRisk??'—'}`;box.append(metrics)}
  return box;
}
function renderTrend(c){
  const trend=c.trend||{};const box=document.createElement('div');box.className='judgement trend-judgement';
  const label=document.createElement('span');label.textContent=`${TREND_LABELS[trend.classification]||'等待趋势验证'} · ${trendScore(c)}分`;box.append(label);
  if(trend.keywordFreshness){const age=document.createElement('small');age.textContent=`关键词历史：${FRESHNESS_LABELS[trend.keywordFreshness]||trend.keywordFreshness}${trend.entityConflict?' · 可能来自其他实体':''}`;box.append(age)}
  if(Number.isFinite(trend.ratio7)){const seven=document.createElement('small');seven.textContent=`主词7天≈${trend.anchor||'itch io'}的 ${(trend.ratio7*100).toFixed(1)}% · 动量 ${trend.sevenDay?.momentum??'—'}x`;box.append(seven)}
  if(Number.isFinite(trend.ratio30)){const thirty=document.createElement('small');thirty.textContent=`主词30天≈${trend.anchor||'itch io'}的 ${(trend.ratio30*100).toFixed(1)}% · 动量 ${trend.thirtyDay?.momentum??'—'}x`;box.append(thirty)}
  if(Number.isFinite(trend.qualifiedRatio30)){const qualified=document.createElement('small');qualified.textContent=`“${c.gameName} game” 30天≈${trend.anchor||'itch io'}的 ${(trend.qualifiedRatio30*100).toFixed(1)}%`;box.append(qualified)}
  const signal=(trend.reasons||[]).find(text=>/上涨|Breakout|尖峰|不是新出现|其他实体/.test(text));
  if(signal){const reason=document.createElement('small');reason.textContent=signal;box.append(reason)}
  else if(!Number.isFinite(trend.ratio7)){const reason=document.createElement('small');reason.textContent=trend.reasons?.[0]||'等待Google Trends需求验证';box.append(reason)}
  return box;
}
function render(){
  renderStats();renderSources();const list=filtered();els.body.textContent='';els.empty.hidden=list.length>0;
  for(const c of list.slice(0,500)){
    const cls=classification(c),tr=document.createElement('tr');
    const scoreTd=document.createElement('td'),score=document.createElement('span');score.className=`score ${cls}`;score.textContent=['pending','error','reject'].includes(cls)?'—':finalScore(c);scoreTd.append(score);
    const gameTd=document.createElement('td'),title=document.createElement('strong'),url=document.createElement('a'),discovery=document.createElement('span');title.className='game-title';title.textContent=c.gameName;url.className='game-url';url.href=c.sources?.[0]?.url||'#';url.target='_blank';url.rel='noopener noreferrer';url.textContent=c.sources?.[0]?.url||'';discovery.className='game-meta';discovery.textContent=`发现分 ${c.discoveryScore??'—'} · ${c.sources?.length||0}个来源 · ${fmtDate(c.firstSeen)}`;gameTd.append(title,url,discovery);
    const adviceTd=document.createElement('td'),advice=document.createElement('span');advice.className=`recommendation ${cls}`;advice.textContent=LABELS[cls]||cls;adviceTd.append(advice);
    const seoTd=document.createElement('td');seoTd.append(renderSeo(c));
    const trendTd=document.createElement('td');trendTd.append(renderTrend(c));
    const sourceTd=document.createElement('td'),chips=document.createElement('div');chips.className='chips';for(const s of c.sources||[]){const chip=document.createElement('span');chip.className='chip';chip.textContent=s.name;chips.append(chip)}sourceTd.append(chips);
    const actions=document.createElement('td'),wrap=document.createElement('div');wrap.className='actions';wrap.append(action('Trends 7天',trends(c.gameName,7)),action('30天',trends(c.gameName,30)),action('主词+game',trends(`${c.gameName} game`,30)),action('SERP',serp(c.gameName)));if(cls==='independent')wrap.append(action('域名',domain(c.gameName)));const copy=document.createElement('button');copy.className='action';copy.textContent='复制';copy.onclick=async()=>{await navigator.clipboard.writeText(c.gameName);toast('已复制游戏名')};const ignore=document.createElement('button');ignore.className='action';ignore.textContent='忽略';ignore.onclick=()=>{statuses[c.id]='ignored';saveStatuses();render();toast('已隐藏')};wrap.append(copy,ignore);actions.append(wrap);
    tr.append(scoreTd,gameTd,adviceTd,seoTd,trendTd,sourceTd,actions);els.body.append(tr);
  }
}
async function load(){els.refresh.disabled=true;try{const stamp=Date.now();const [cRes,rRes]=await Promise.all([fetch(`${DATA_URL}?v=${stamp}`,{cache:'no-store'}),fetch(`${REPORT_URL}?v=${stamp}`,{cache:'no-store'})]);if(!cRes.ok)throw new Error('候选数据读取失败');const cJson=await cRes.json();candidates=Array.isArray(cJson)?cJson:cJson.candidates||[];report=rRes.ok?await rRes.json():{};render()}catch(e){toast(e.message);render()}finally{els.refresh.disabled=false}}
els.search.addEventListener('input',render);els.recommendation.addEventListener('change',render);els.time.addEventListener('change',render);els.refresh.addEventListener('click',()=>load().then(()=>toast('结果已刷新')));els.export.addEventListener('click',()=>{const rows=[['Game Name','Final Score','Recommendation','SEO Score','Name Risk','Trend Class','Trend Score','Keyword Freshness','Entity Conflict','7d vs Anchor','7d Momentum','30d vs Anchor','30d Momentum','Game-qualified 30d','Discovery Score','Reasons','Sources','URL'],...filtered().map(c=>[c.gameName,finalScore(c),LABELS[classification(c)]||classification(c),seoScore(c),c.seo?.nameRisk??'',c.trend?.classification??'',trendScore(c),c.trend?.keywordFreshness??'',c.trend?.entityConflict??false,c.trend?.ratio7??'',c.trend?.sevenDay?.momentum??'',c.trend?.ratio30??'',c.trend?.thirtyDay?.momentum??'',c.trend?.qualifiedRatio30??'',c.discoveryScore||0,[...(c.seo?.reasons||[]),...(c.trend?.reasons||[])].join(' | '),(c.sources||[]).map(s=>s.name).join(' | '),c.sources?.[0]?.url||''])];const csv='\ufeff'+rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`game-rising-results-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href)});
load();setInterval(load,5*60*1000);
