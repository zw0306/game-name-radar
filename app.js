const KEYS = {
  sources: 'gameRadar.sources.v1', snapshots: 'gameRadar.snapshots.v1',
  candidates: 'gameRadar.candidates.v1', scanLog: 'gameRadar.scanLog.v1', lastScan: 'gameRadar.lastScan.v1',
};

const BUILTINS = [
  ['itch-newest-web','itch.io 最新网页游戏','https://itch.io/games/newest/platform-web','itch-new','itch-listing'],
  ['itch-new-popular-web','itch.io New & Popular','https://itch.io/games/new-and-popular/platform-web','itch-popular','itch-listing'],
  ['itch-new-feed','itch.io New Feed','https://itch.io/feed/new.xml','itch-new','feed'],
  ['itch-featured-feed','itch.io Featured Feed','https://itch.io/feed/featured.xml','itch-featured','feed'],
].map(([id,name,url,kind,fetchKind]) => ({ id,name,url,kind,fetchKind,enabled:true,baselineOnly:false }));

const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const state = {
  sources: load(KEYS.sources, []), snapshots: load(KEYS.snapshots, {}),
  candidates: load(KEYS.candidates, []), scanLog: load(KEYS.scanLog, []),
  lastScan: localStorage.getItem(KEYS.lastScan) || '', newThisScan: 0, scanning: false,
};
const $ = (selector) => document.querySelector(selector);
const els = {
  sourceCount: $('#sourceCount'), newCount: $('#newCount'), candidateCount: $('#candidateCount'), hotCount: $('#hotCount'),
  lastScan: $('#lastScan'), scanActivity: $('#scanActivity'), sourceBody: $('#sourceTableBody'), sourceEmpty: $('#sourceEmpty'),
  candidateBody: $('#candidateTableBody'), candidateEmpty: $('#candidateEmpty'), modal: $('#sourceModal'), form: $('#sourceForm'),
  sourceName: $('#sourceName'), sourceUrl: $('#sourceUrl'), sourceKind: $('#sourceKind'), baseline: $('#baselineOnly'),
  scanBtn: $('#scanBtn'), search: $('#candidateSearch'), level: $('#levelFilter'), status: $('#statusFilter'),
  toast: $('#toast'), importInput: $('#importInput'),
};

function save() {
  localStorage.setItem(KEYS.sources, JSON.stringify(state.sources));
  localStorage.setItem(KEYS.snapshots, JSON.stringify(state.snapshots));
  localStorage.setItem(KEYS.candidates, JSON.stringify(state.candidates));
  localStorage.setItem(KEYS.scanLog, JSON.stringify(state.scanLog.slice(0, 50)));
  if (state.lastScan) localStorage.setItem(KEYS.lastScan, state.lastScan);
}
const uid = (prefix='source') => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
function notify(message, type='') {
  els.toast.textContent = message; els.toast.className = `toast show ${type}`.trim();
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { els.toast.className = 'toast'; }, 3000);
}
const labels = { 'competitor-sitemap':'竞争站 Sitemap', sitemap:'Sitemap', feed:'RSS / Atom', 'itch-new':'itch.io 新作', 'itch-popular':'itch.io 热门', 'itch-featured':'itch.io 精选', auto:'自动识别' };
const normalize = (value='') => value.toLowerCase().normalize('NFKD').replace(/[’'`]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\b(play|online|game|games|free|unblocked|html5|browser)\b/g,' ').replace(/\s+/g,' ').trim();
function score(candidate) {
  const kinds = new Set((candidate.sources || []).map(s => s.kind)); let total = 0;
  for (const kind of kinds) total += kind === 'itch-featured' ? 5 : kind === 'itch-popular' ? 4 : kind === 'competitor-sitemap' ? 3 : ['itch-new','feed'].includes(kind) ? 2 : 1;
  if (candidate.sources.length >= 3) total += 7; else if (candidate.sources.length === 2) total += 4;
  const words = candidate.gameName.trim().split(/\s+/).filter(Boolean).length;
  if (candidate.gameName.length >= 5 && candidate.gameName.length <= 45 && words <= 6) total += 2;
  if (/^(game|games|new game|online game|untitled|test|demo)$/i.test(candidate.gameName)) total -= 5;
  const dates = candidate.sources.map(s => Date.parse(s.date || '')).filter(Number.isFinite);
  if (dates.length && Date.now() - Math.max(...dates) < 259200000) total += 2;
  return Math.max(0, Math.min(20, total));
}
const level = (value) => value >= 12 ? 'hot' : value >= 7 ? 'verify' : 'watch';
const dateText = (value) => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d); };
const external = (text, url) => { const a = document.createElement('a'); a.className='verify-link'; a.textContent=text; a.href=url; a.target='_blank'; a.rel='noopener'; return a; };

function renderStats() {
  const active = state.candidates.filter(c => !['ignored','done'].includes(c.status));
  els.sourceCount.textContent = state.sources.filter(s => s.enabled).length;
  els.newCount.textContent = state.newThisScan;
  els.candidateCount.textContent = active.length;
  els.hotCount.textContent = active.filter(c => score(c) >= 12).length;
  els.lastScan.textContent = state.lastScan ? `上次：${dateText(state.lastScan)}` : '尚未扫描';
}
function renderSources() {
  els.sourceBody.replaceChildren(); els.sourceEmpty.hidden = state.sources.length > 0;
  state.sources.forEach(source => {
    const row = document.createElement('tr');
    const tdToggle = document.createElement('td'); const toggle = document.createElement('button');
    toggle.className = `switch ${source.enabled ? 'on' : ''}`; toggle.title = source.enabled ? '停用' : '启用';
    toggle.onclick = () => { source.enabled = !source.enabled; save(); render(); }; tdToggle.append(toggle);
    const tdName = document.createElement('td'); const strong = document.createElement('strong'); strong.textContent=source.name; tdName.append(strong);
    const tdKind = document.createElement('td'); const tag = document.createElement('span'); tag.className='tag'; tag.textContent=labels[source.kind] || source.kind; tdKind.append(tag);
    const tdUrl = document.createElement('td'); tdUrl.className='url-cell'; tdUrl.textContent=source.url; tdUrl.title=source.url;
    const tdSnap = document.createElement('td'); const count=state.snapshots[source.id]?.urls?.length || 0; tdSnap.textContent=count?`${count} 条`:'未建立';
    const tdAction = document.createElement('td'); const remove=document.createElement('button'); remove.className='icon-button'; remove.textContent='×';
    remove.onclick=()=>{ if(confirm(`删除监控源“${source.name}”？`)){ state.sources=state.sources.filter(s=>s.id!==source.id); delete state.snapshots[source.id]; save(); render(); } }; tdAction.append(remove);
    row.append(tdToggle,tdName,tdKind,tdUrl,tdSnap,tdAction); els.sourceBody.append(row);
  });
}
function filteredCandidates() {
  const q=els.search.value.trim().toLowerCase(), l=els.level.value, st=els.status.value;
  return state.candidates.map(c=>({...c,computedScore:score(c)})).filter(c=>{
    const lv=level(c.computedScore), text=`${c.gameName} ${(c.sources||[]).map(s=>s.name).join(' ')}`.toLowerCase();
    if(q && !text.includes(q)) return false; if(l!=='all' && lv!==l) return false;
    if(st==='active' && ['ignored','done'].includes(c.status)) return false; if(!['all','active'].includes(st) && c.status!==st) return false; return true;
  }).sort((a,b)=>b.computedScore-a.computedScore || Date.parse(b.firstSeen)-Date.parse(a.firstSeen));
}
function renderCandidates() {
  const list=filteredCandidates(); els.candidateBody.replaceChildren(); els.candidateEmpty.hidden=list.length>0;
  list.forEach(candidate=>{
    const row=document.createElement('tr'), lv=level(candidate.computedScore);
    const tdScore=document.createElement('td'); const badge=document.createElement('span'); badge.className=`score-badge ${lv}`; badge.textContent=candidate.computedScore; tdScore.append(badge);
    const tdName=document.createElement('td'); tdName.className='game-name-cell'; const strong=document.createElement('strong'); strong.textContent=candidate.gameName; tdName.append(strong);
    const firstUrl=candidate.sources?.[0]?.url; if(firstUrl){ const a=document.createElement('a'); a.href=firstUrl; a.target='_blank'; a.rel='noopener'; a.textContent=firstUrl; tdName.append(a); }
    const tdSources=document.createElement('td'); const chips=document.createElement('div'); chips.className='source-chips'; (candidate.sources||[]).forEach(s=>{const chip=document.createElement('span');chip.className='source-chip';chip.textContent=s.name;chips.append(chip)}); tdSources.append(chips);
    const tdDate=document.createElement('td'); tdDate.textContent=dateText(candidate.firstSeen);
    const tdStatus=document.createElement('td'); const select=document.createElement('select'); select.className='status-select';
    [['new','未处理'],['selected','准备建站'],['done','已建站'],['ignored','忽略']].forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;o.selected=(candidate.status||'new')===v;select.append(o)});
    select.onchange=()=>{const original=state.candidates.find(c=>c.id===candidate.id);if(original){original.status=select.value;save();render();}}; tdStatus.append(select);
    const tdVerify=document.createElement('td'); const actions=document.createElement('div'); actions.className='verify-actions'; const q=encodeURIComponent(candidate.gameName);
    actions.append(external('Trends 7天',`https://trends.google.com/trends/explore?date=now%207-d&geo=US&q=${q}`),external('30天',`https://trends.google.com/trends/explore?date=today%201-m&geo=US&q=${q}`),external('SERP',`https://www.google.com/search?q=${encodeURIComponent(`"${candidate.gameName}" game play online`)}`),external('域名',`https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(normalize(candidate.gameName).replace(/\s+/g,'').slice(0,45))}`)); tdVerify.append(actions);
    row.append(tdScore,tdName,tdSources,tdDate,tdStatus,tdVerify); els.candidateBody.append(row);
  });
}
function renderActivity() {
  els.scanActivity.replaceChildren();
  if(!state.scanLog.length){els.scanActivity.className='activity-list empty-state';els.scanActivity.textContent='添加监控源后点击“立即扫描”。';return;}
  els.scanActivity.className='activity-list'; state.scanLog.slice(0,10).forEach(log=>{
    const item=document.createElement('div');item.className='activity-item'; const title=document.createElement('strong');title.textContent=log.sourceName;
    const total=document.createElement('span');total.textContent=`${log.total||0} 条`; const added=document.createElement('span');added.textContent=`新增 ${log.added||0}`;
    const status=document.createElement('span');status.className=`activity-status ${log.ok?'ok':'error'}`;status.textContent=log.ok?dateText(log.scannedAt):log.error;item.append(title,total,added,status);els.scanActivity.append(item);
  });
}
function render(){renderStats();renderSources();renderCandidates();renderActivity();}
function apiSource(source){return{id:source.id,name:source.name,url:source.url,kind:source.fetchKind || (source.kind.includes('sitemap')?'sitemap':source.kind.includes('itch')?'itch-listing':source.kind)};}
function mergeCandidate(gameName,source,entry){const normalized=normalize(gameName);if(!normalized||normalized.length<2)return false;let c=state.candidates.find(x=>x.normalizedName===normalized);if(!c){c={id:uid('game'),gameName,normalizedName:normalized,firstSeen:new Date().toISOString(),lastSeen:new Date().toISOString(),status:'new',sources:[]};state.candidates.push(c)}const key=`${source.id}|${entry.url}`;if(!c.sources.some(x=>x.key===key))c.sources.push({key,sourceId:source.id,name:source.name,kind:source.kind,url:entry.url,date:entry.date||''});c.lastSeen=new Date().toISOString();return true;}
async function scan(){
  if(state.scanning)return;const sources=state.sources.filter(s=>s.enabled);if(!sources.length)return notify('请先添加并启用监控源','error');
  state.scanning=true;state.newThisScan=0;els.scanBtn.classList.add('loading');els.scanBtn.disabled=true;
  try{const response=await fetch('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sources:sources.map(apiSource)})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'扫描请求失败');const logs=[];
    for(const result of payload.results){const source=state.sources.find(s=>s.id===result.sourceId);if(!source)continue;if(!result.ok){logs.push({...result,total:0,added:0});continue}const previous=state.snapshots[source.id],old=new Set(previous?.urls||[]),first=!previous;const entries=first&&source.baselineOnly?[]:result.entries.filter(e=>!old.has(e.url));let added=0;for(const entry of entries)if(mergeCandidate(entry.gameName,source,entry))added++;state.snapshots[source.id]={urls:result.entries.map(e=>e.url),scannedAt:result.scannedAt,detectedType:result.detectedType};state.newThisScan+=added;logs.push({ok:true,sourceName:source.name,sourceId:source.id,total:result.entries.length,added,scannedAt:result.scannedAt});}
    state.scanLog=[...logs,...state.scanLog].slice(0,50);state.lastScan=payload.scannedAt;save();render();notify(`扫描完成，发现 ${state.newThisScan} 个新增名称`);
  }catch(error){notify(error.message||'扫描失败','error')}finally{state.scanning=false;els.scanBtn.classList.remove('loading');els.scanBtn.disabled=false}
}
function addBuiltins(){let added=0;for(const item of BUILTINS){if(state.sources.some(s=>s.id===item.id||s.url===item.url))continue;state.sources.push({...item});added++}save();render();notify(added?`已添加 ${added} 个 itch.io 内置源`:'内置源已经存在');}
function download(name,data,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),0);}
function backup(){download(`game-radar-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({version:1,exportedAt:new Date().toISOString(),...state},null,2));}
function exportCsv(){const rows=[['Game Name','Score','Level','Status','First Seen','Sources','URLs']];for(const c of filteredCandidates())rows.push([c.gameName,c.computedScore,level(c.computedScore),c.status,c.firstSeen,c.sources.map(s=>s.name).join(' | '),c.sources.map(s=>s.url).join(' | ')]);const csv='\ufeff'+rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');download(`game-radar-candidates-${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv;charset=utf-8');}
async function importBackup(file){try{const p=JSON.parse(await file.text());if(!Array.isArray(p.sources)||!Array.isArray(p.candidates))throw new Error('备份格式不正确');state.sources=p.sources;state.snapshots=p.snapshots||{};state.candidates=p.candidates;state.scanLog=p.scanLog||[];state.lastScan=p.lastScan||'';save();render();notify('备份导入成功')}catch(e){notify(e.message||'导入失败','error')}finally{els.importInput.value=''}}
async function loadAutomated(){try{const r=await fetch('/data/candidates.json',{cache:'no-store'});if(!r.ok)return;const p=await r.json(),list=Array.isArray(p)?p:p.candidates;if(!Array.isArray(list))return;let changed=false;for(const remote of list){const n=remote.normalizedName||normalize(remote.gameName);if(!n)continue;let local=state.candidates.find(c=>c.normalizedName===n);if(!local){state.candidates.push({...remote,id:remote.id||uid('auto'),normalizedName:n,status:remote.status||'new'});changed=true;continue}for(const source of remote.sources||[]){const key=source.key||`${source.sourceId}|${source.url}`;if(!local.sources.some(s=>(s.key||`${s.sourceId}|${s.url}`)===key)){local.sources.push({...source,key});changed=true}}}if(changed){save();render()}}catch{}}

document.querySelectorAll('[data-scroll]').forEach(button=>button.onclick=()=>{document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));button.classList.add('active');$(`#${button.dataset.scroll}`).scrollIntoView({behavior:'smooth'})});
$('#openSourceModal').onclick=()=>els.modal.showModal();$('#closeSourceModal').onclick=$('#cancelSourceModal').onclick=()=>els.modal.close();$('#addBuiltinsBtn').onclick=addBuiltins;$('#backupBtn').onclick=backup;$('#exportCsvBtn').onclick=exportCsv;els.scanBtn.onclick=scan;
els.importInput.onchange=()=>els.importInput.files[0]&&importBackup(els.importInput.files[0]);[els.search,els.level,els.status].forEach(e=>e.addEventListener('input',renderCandidates));
els.sourceKind.onchange=()=>{els.baseline.checked=els.sourceKind.value.includes('sitemap')};
els.form.onsubmit=(event)=>{event.preventDefault();const kind=els.sourceKind.value;state.sources.push({id:uid(),name:els.sourceName.value.trim(),url:els.sourceUrl.value.trim(),kind,fetchKind:kind.includes('sitemap')?'sitemap':kind,enabled:true,baselineOnly:els.baseline.checked});save();render();els.form.reset();els.baseline.checked=true;els.modal.close();notify('监控源已添加')};
render();loadAutomated();
