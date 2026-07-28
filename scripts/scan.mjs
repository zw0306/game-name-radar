import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource, normalizeGameName, calculateCandidateScore, candidateLevel } from '../lib/scanner.mjs';
import { scanSteamSource } from '../lib/steam-discovery.mjs';
import { discoverRisingGameQueries } from '../lib/rising-discovery.mjs';
import { verifyGameKeyword, cleanGameName, estimateNameRisk } from '../lib/seo-verifier.mjs';
import { verifyTrendDemand } from '../lib/trend-verifier.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourcesPath=path.join(root,'config','sources.json');
const statePath=path.join(root,'data','state.json');
const candidatesPath=path.join(root,'data','candidates.json');
const reportPath=path.join(root,'data','latest-report.json');
const VERIFY_LIMIT=Math.max(1,Math.min(50,Number(process.env.SEO_VERIFY_LIMIT||30)));
const TREND_LIMIT=Math.max(1,Math.min(10,Number(process.env.TRENDS_VERIFY_LIMIT||6)));
const VERIFY_MAX_AGE=3*86400000;
const TREND_MAX_AGE=86400000;
const TREND_ERROR_RETRY=3600000;
const TREND_BATCH_INTERVAL=30*60000;
const RISING_DISCOVERY_INTERVAL=3*3600000;
const SEO_MODEL_VERSION=4;
const TREND_MODEL_VERSION=3;
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return fallback}}

function sourceKinds(candidate){return new Set((candidate.sources||[]).map(source=>source.kind))}

function updateDiscovery(candidate){
  const kinds=sourceKinds(candidate);
  let score=calculateCandidateScore(candidate);
  if(kinds.has('trends-rising-7d'))score+=8;
  if(kinds.has('trends-rising-30d'))score+=6;
  if(kinds.has('steam-popular-new'))score+=4;
  if(kinds.has('itch-jam-popular'))score+=4;
  if(kinds.has('itch-jam-new'))score+=2;
  if(kinds.has('newgrounds-top'))score+=2;
  candidate.discoveryScore=Math.min(20,score);
  candidate.discoveryLevel=candidateLevel(candidate.discoveryScore);
}

function normalizeCandidateName(candidate){
  const cleaned=cleanGameName(candidate.gameName||'');
  if(!cleaned)return false;
  const normalized=normalizeGameName(cleaned);
  if(!normalized)return false;
  if(cleaned!==candidate.gameName||normalized!==candidate.normalizedName){
    candidate.gameName=cleaned;
    candidate.normalizedName=normalized;
    delete candidate.seo;
    delete candidate.trend;
    candidate.score=0;
    candidate.level='pending';
    candidate.recommendation='pending';
  }
  return true;
}

function dedupeCandidates(items){
  const map=new Map();
  for(const item of items){
    if(!normalizeCandidateName(item))continue;
    const existing=map.get(item.normalizedName);
    if(!existing){map.set(item.normalizedName,item);continue}
    const sourceKeys=new Set((existing.sources||[]).map(source=>source.key));
    for(const source of item.sources||[])if(!sourceKeys.has(source.key)){existing.sources.push(source);sourceKeys.add(source.key)}
    if(Date.parse(item.firstSeen)<Date.parse(existing.firstSeen))existing.firstSeen=item.firstSeen;
    if(Date.parse(item.lastSeen)>Date.parse(existing.lastSeen))existing.lastSeen=item.lastSeen;
    if(!existing.seo&&item.seo)existing.seo=item.seo;
    if(!existing.trend&&item.trend)existing.trend=item.trend;
  }
  return [...map.values()];
}

function mergeCandidate(candidates,gameName,source,entry,now){
  const cleanedName=cleanGameName(gameName);
  const normalizedName=normalizeGameName(cleanedName);
  if(!normalizedName||normalizedName.length<2)return false;
  let candidate=candidates.find(item=>item.normalizedName===normalizedName);
  if(!candidate){
    candidate={id:`auto-${Buffer.from(normalizedName).toString('base64url').slice(0,24)}`,gameName:cleanedName,normalizedName,firstSeen:now,lastSeen:now,status:'new',sources:[],recommendation:'pending'};
    candidates.push(candidate);
  }
  const key=`${source.id}|${entry.url}`;
  if(!candidate.sources.some(item=>item.key===key))candidate.sources.push({
    key,sourceId:source.id,name:source.name,kind:source.kind,url:entry.url,date:entry.date||'',
    growth:entry.growth||'',seed:entry.seed||'',windowDays:entry.windowDays||null,
  });
  candidate.lastSeen=now;
  updateDiscovery(candidate);
  return true;
}

function needsSeoCheck(candidate){
  if(candidate.seo?.modelVersion!==SEO_MODEL_VERSION)return true;
  const checked=Date.parse(candidate.seo?.checkedAt||'');
  if(!Number.isFinite(checked))return true;
  if(candidate.seo?.status==='error')return Date.now()-checked>12*3600000;
  return Date.now()-checked>VERIFY_MAX_AGE;
}

function shouldAutoVerify(candidate){
  const kinds=sourceKinds(candidate);
  const risk=estimateNameRisk(candidate.gameName);
  return kinds.has('trends-rising-7d')||kinds.has('trends-rising-30d')||kinds.has('steam-popular-new')||
    candidate.sources?.length>=2||kinds.has('itch-featured')||kinds.has('itch-popular')||kinds.has('itch-jam-popular')||
    kinds.has('newgrounds-top')||(kinds.has('steam-new')&&risk<=12)||(kinds.has('itch-new')&&risk<=12)||
    ((candidate.discoveryScore||0)>=7&&risk<=16);
}

function verifyPriority(candidate){
  const kinds=sourceKinds(candidate);
  let score=(candidate.discoveryScore||0)+(30-estimateNameRisk(candidate.gameName));
  if(kinds.has('trends-rising-7d'))score+=35;
  if(kinds.has('trends-rising-30d'))score+=25;
  if(kinds.has('itch-featured'))score+=16;
  if(kinds.has('itch-popular'))score+=12;
  if(kinds.has('newgrounds-top'))score+=10;
  if(kinds.has('steam-popular-new'))score+=10;
  if(kinds.has('itch-new'))score+=4;
  if((candidate.sources||[]).length>=2)score+=10;
  return score;
}

function hasStrongDiscoverySignal(candidate){
  const kinds=sourceKinds(candidate);
  const risk=Number(candidate.seo?.nameRisk??estimateNameRisk(candidate.gameName));
  const seoScore=Number(candidate.seo?.score||0);
  if(kinds.has('trends-rising-7d')||kinds.has('trends-rising-30d'))return true;
  if(kinds.has('itch-featured')||kinds.has('itch-popular')||kinds.has('newgrounds-top')||kinds.has('steam-popular-new'))return risk<=14;
  if((candidate.sources||[]).length>=2)return risk<=14;
  return (candidate.discoveryScore||0)>=7&&risk<=8&&seoScore>=60;
}

function isTrendEligible(candidate){
  if(!['independent','page'].includes(candidate.seo?.classification))return false;
  if(Number(candidate.seo?.score||0)<42)return false;
  if(Number(candidate.seo?.nameRisk??30)>14)return false;
  if(candidate.seo?.entityConflict)return false;
  return hasStrongDiscoverySignal(candidate);
}

function needsTrendCheck(candidate){
  if(!isTrendEligible(candidate))return false;
  if(candidate.trend?.modelVersion!==TREND_MODEL_VERSION)return true;
  const checked=Date.parse(candidate.trend?.checkedAt||'');
  if(!Number.isFinite(checked))return true;
  if(candidate.trend?.status==='error')return Date.now()-checked>TREND_ERROR_RETRY;
  return Date.now()-checked>TREND_MAX_AGE;
}

function trendPriority(candidate){
  const kinds=sourceKinds(candidate);
  let score=(candidate.seo?.score||0)+(candidate.discoveryScore||0)*2;
  if(kinds.has('trends-rising-7d'))score+=45;
  if(kinds.has('trends-rising-30d'))score+=32;
  if(kinds.has('itch-featured'))score+=18;
  if(kinds.has('itch-popular'))score+=14;
  if(kinds.has('newgrounds-top'))score+=12;
  if(kinds.has('steam-popular-new'))score+=10;
  if(candidate.seo?.classification==='independent')score+=18;
  if((candidate.sources||[]).length>=2)score+=12;
  const age=Date.now()-Date.parse(candidate.firstSeen||0);
  if(Number.isFinite(age)&&age<2*86400000)score+=8;
  score-=Number(candidate.seo?.nameRisk||0)*1.5;
  return score;
}

function applyFinalRecommendation(candidate){
  const seoClass=candidate.seo?.classification||'pending';
  const demandClass=candidate.trend?.classification||'pending';
  const nameRisk=Number(candidate.seo?.nameRisk??30);
  const keywordFreshness=candidate.trend?.keywordFreshness||'unknown';
  const entityConflict=Boolean(candidate.seo?.entityConflict||candidate.trend?.entityConflict);
  let recommendation='pending';

  if(seoClass==='error')recommendation='error';
  else if(seoClass==='reject'||candidate.seo?.entityConflict)recommendation='reject';
  else if(seoClass==='pending')recommendation='pending';
  else if(!isTrendEligible(candidate))recommendation='reject';
  else if(demandClass==='error'||demandClass==='pending')recommendation='pending';
  else if(demandClass==='none')recommendation='reject';
  else if(demandClass==='weak')recommendation='watch';
  else if(seoClass==='independent'&&nameRisk<=12&&keywordFreshness!=='existing'&&!entityConflict&&['rising','breakout'].includes(demandClass))recommendation='independent';
  else if(['independent','page'].includes(seoClass)&&['strong','rising','breakout','moderate'].includes(demandClass))recommendation='page';
  else recommendation='watch';

  const seoScore=Number(candidate.seo?.score||0);
  const trendScore=Number(candidate.trend?.score||0);
  let finalScore=Math.round(seoScore*0.48+trendScore*0.52);
  if(['rising','breakout'].includes(demandClass))finalScore=Math.min(100,finalScore+8);
  if(keywordFreshness==='existing'||entityConflict)finalScore=Math.min(finalScore,69);
  if(recommendation==='watch')finalScore=Math.min(finalScore,59);
  if(recommendation==='reject'||recommendation==='pending'||recommendation==='error')finalScore=0;
  candidate.finalScore=finalScore;
  candidate.score=finalScore;
  candidate.level=recommendation;
  candidate.recommendation=recommendation;
}

function recommendationRank(candidate){
  return {independent:6,page:5,watch:4,pending:3,reject:2,error:1}[candidate.recommendation||'pending']||0;
}

async function processSourceResult({source,result,candidates,radarState,logs,now}){
  const previous=radarState.snapshots[source.id];
  const previousUrls=new Set(previous?.urls||[]);
  const firstScan=!previous;
  const newEntries=firstScan&&source.baselineOnly?[]:result.entries.filter(entry=>!previousUrls.has(entry.url));
  const newUrls=new Set(newEntries.map(entry=>entry.url));
  let added=0;
  if(!(firstScan&&source.baselineOnly)){
    for(const entry of result.entries){const merged=mergeCandidate(candidates,entry.gameName,source,entry,now);if(merged&&newUrls.has(entry.url))added+=1}
  }
  radarState.snapshots[source.id]={urls:result.entries.map(entry=>entry.url),scannedAt:result.scannedAt||now,detectedType:result.detectedType||source.kind};
  logs.push({ok:true,sourceId:source.id,sourceName:source.name,total:result.entries.length,added});
  console.log(`✓ ${source.name}: ${result.entries.length} entries, ${added} new`);
  return added;
}

const sources=(await readJson(sourcesPath,[])).filter(source=>source.enabled!==false);
const radarState=await readJson(statePath,{snapshots:{},lastScan:null,lastRisingDiscovery:null,lastTrendBatch:null});
const candidatePayload=await readJson(candidatesPath,{candidates:[]});
let candidates=dedupeCandidates(Array.isArray(candidatePayload)?candidatePayload:candidatePayload.candidates||[]);
const now=new Date().toISOString();
const logs=[];
let totalAdded=0;

for(const source of sources){
  try{
    const result=source.fetchKind==='steam-listing'
      ? await scanSteamSource(source)
      : await scanSource({...source,kind:source.fetchKind||(source.kind?.includes('sitemap')?'sitemap':source.kind?.includes('itch')?'itch-listing':source.kind||'auto')});
    totalAdded+=await processSourceResult({source,result,candidates,radarState,logs,now});
  }catch(error){logs.push({ok:false,sourceId:source.id,sourceName:source.name,error:error.message});console.error(`✗ ${source.name}: ${error.message}`)}
}

let risingDiscoveryRan=false;
const lastRising=Date.parse(radarState.lastRisingDiscovery||'');
if(!Number.isFinite(lastRising)||Date.now()-lastRising>=RISING_DISCOVERY_INTERVAL){
  risingDiscoveryRan=true;
  const risingResults=await discoverRisingGameQueries();
  for(const item of risingResults){
    const source=item.source;
    if(!item.ok){logs.push({ok:false,sourceId:source.id,sourceName:source.name,error:item.error||'Trends related queries failed'});continue}
    const result={entries:item.entries.slice(0,30),detectedType:'trends-related-rising',scannedAt:now};
    totalAdded+=await processSourceResult({source,result,candidates,radarState,logs,now});
  }
  radarState.lastRisingDiscovery=now;
}

candidates=dedupeCandidates(candidates);
for(const candidate of candidates)updateDiscovery(candidate);
const verifyQueue=candidates.filter(candidate=>needsSeoCheck(candidate)&&shouldAutoVerify(candidate)).sort((a,b)=>verifyPriority(b)-verifyPriority(a)||Date.parse(b.firstSeen)-Date.parse(a.firstSeen)).slice(0,VERIFY_LIMIT);
let seoVerified=0,seoErrors=0;
for(const candidate of verifyQueue){
  try{
    console.log(`SEO verify: ${candidate.gameName}`);
    candidate.seo={modelVersion:SEO_MODEL_VERSION,...await verifyGameKeyword(candidate.gameName,candidate.discoveryScore||0)};
    seoVerified+=1;
  }catch(error){
    candidate.seo={modelVersion:SEO_MODEL_VERSION,checkedAt:new Date().toISOString(),status:'error',classification:'error',score:0,reasons:[`自动验证失败：${error.message}`]};
    seoErrors+=1;
    console.error(`SEO verify failed: ${candidate.gameName}: ${error.message}`);
  }
  await sleep(850);
}

for(const candidate of candidates){
  if(!candidate.seo)candidate.seo={modelVersion:SEO_MODEL_VERSION,status:'pending',classification:'pending',score:0,reasons:['等待自动搜索意图验证']};
}

const trendEligibleBefore=candidates.filter(isTrendEligible);
const urgentModelUpgrade=trendEligibleBefore.some(candidate=>candidate.trend?.modelVersion!==TREND_MODEL_VERSION);
let trendsVerified=0,trendErrors=0,trendBatchRan=false,trendQueueSize=0;
const lastTrendBatch=Date.parse(radarState.lastTrendBatch||'');
const trendBatchDue=urgentModelUpgrade||!Number.isFinite(lastTrendBatch)||Date.now()-lastTrendBatch>=TREND_BATCH_INTERVAL;
if(trendBatchDue){
  trendBatchRan=true;
  const limit=risingDiscoveryRan?Math.min(2,TREND_LIMIT):TREND_LIMIT;
  const trendQueue=candidates.filter(needsTrendCheck).sort((a,b)=>trendPriority(b)-trendPriority(a)||Date.parse(b.firstSeen)-Date.parse(a.firstSeen)).slice(0,limit);
  trendQueueSize=trendQueue.length;
  for(const candidate of trendQueue){
    const previousTrend=candidate.trend;
    try{
      console.log(`Trends verify: ${candidate.gameName}`);
      candidate.trend=await verifyTrendDemand(candidate.gameName);
      trendsVerified+=1;
    }catch(error){
      const previousIsValid=previousTrend&&!['error','pending'].includes(previousTrend.classification);
      if(previousIsValid){
        candidate.trend={...previousTrend,stale:true,lastError:error.message,lastErrorAt:new Date().toISOString()};
      }else{
        candidate.trend={modelVersion:TREND_MODEL_VERSION,checkedAt:new Date().toISOString(),status:'error',classification:'error',score:0,reasons:[`趋势验证失败：${error.message}`]};
      }
      trendErrors+=1;
      console.error(`Trends verify failed: ${candidate.gameName}: ${error.message}`);
    }
    await sleep(12000);
  }
  if(trendQueue.length)radarState.lastTrendBatch=now;
}

for(const candidate of candidates){
  if(isTrendEligible(candidate)&&!candidate.trend){
    candidate.trend={modelVersion:TREND_MODEL_VERSION,status:'pending',classification:'pending',score:0,reasons:['等待Google Trends需求验证']};
  }
  applyFinalRecommendation(candidate);
}

candidates.sort((a,b)=>recommendationRank(b)-recommendationRank(a)||(b.finalScore||0)-(a.finalScore||0)||(b.trend?.score||0)-(a.trend?.score||0)||(b.seo?.score||0)-(a.seo?.score||0)||(b.discoveryScore||0)-(a.discoveryScore||0)||Date.parse(b.firstSeen)-Date.parse(a.firstSeen));
if(candidates.length>3000)candidates.length=3000;

const recommendationCounts={independent:0,page:0,watch:0,reject:0,pending:0,error:0};
for(const candidate of candidates)recommendationCounts[candidate.recommendation||'pending']=(recommendationCounts[candidate.recommendation||'pending']||0)+1;
const seoPassedCount=candidates.filter(candidate=>['independent','page'].includes(candidate.seo?.classification)).length;
const trendEligibleCount=candidates.filter(isTrendEligible).length;
const trendPendingCount=candidates.filter(candidate=>isTrendEligible(candidate)&&needsTrendCheck(candidate)).length;
const trendValidatedCount=candidates.filter(candidate=>isTrendEligible(candidate)&&candidate.trend?.modelVersion===TREND_MODEL_VERSION&&!['pending','error'].includes(candidate.trend?.classification)).length;
const risingCount=candidates.filter(candidate=>['rising','breakout'].includes(candidate.trend?.classification)).length;
radarState.lastScan=now;
await fs.writeFile(statePath,JSON.stringify(radarState,null,2)+'\n');
await fs.writeFile(candidatesPath,JSON.stringify({updatedAt:now,candidates},null,2)+'\n');
await fs.writeFile(reportPath,JSON.stringify({scannedAt:now,totalAdded,sources:logs,seoVerified,seoErrors,trendsVerified,trendErrors,trendBatchRan,trendQueueSize,risingDiscoveryRan,seoModelVersion:SEO_MODEL_VERSION,trendModelVersion:TREND_MODEL_VERSION,seoPassedCount,trendEligibleCount,trendPendingCount,trendValidatedCount,risingCount,recommendationCounts},null,2)+'\n');
console.log(`Scan complete. ${totalAdded} names added; ${seoVerified} SEO checks; ${trendsVerified} Trends checks; ${trendPendingCount} trend candidates pending.`);
