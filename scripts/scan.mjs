import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource, normalizeGameName, calculateCandidateScore, candidateLevel } from '../lib/scanner.mjs';
import { verifyGameKeyword } from '../lib/seo-verifier.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourcesPath=path.join(root,'config','sources.json');
const statePath=path.join(root,'data','state.json');
const candidatesPath=path.join(root,'data','candidates.json');
const reportPath=path.join(root,'data','latest-report.json');
const VERIFY_LIMIT=Math.max(1,Math.min(30,Number(process.env.SEO_VERIFY_LIMIT||12)));
const VERIFY_MAX_AGE=7*86400000;
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return fallback}}

function updateDiscovery(candidate){
  candidate.discoveryScore=calculateCandidateScore(candidate);
  candidate.discoveryLevel=candidateLevel(candidate.discoveryScore);
}

function mergeCandidate(candidates,gameName,source,entry,now){
  const normalizedName=normalizeGameName(gameName);
  if(!normalizedName||normalizedName.length<2)return false;
  let candidate=candidates.find(item=>item.normalizedName===normalizedName);
  if(!candidate){
    candidate={id:`auto-${Buffer.from(normalizedName).toString('base64url').slice(0,24)}`,gameName,normalizedName,firstSeen:now,lastSeen:now,status:'new',sources:[]};
    candidates.push(candidate);
  }
  const key=`${source.id}|${entry.url}`;
  if(!candidate.sources.some(item=>item.key===key))candidate.sources.push({key,sourceId:source.id,name:source.name,kind:source.kind,url:entry.url,date:entry.date||''});
  candidate.lastSeen=now;
  updateDiscovery(candidate);
  return true;
}

function needsSeoCheck(candidate){
  const checked=Date.parse(candidate.seo?.checkedAt||'');
  if(!Number.isFinite(checked))return true;
  if(candidate.seo?.status==='error')return Date.now()-checked>12*3600000;
  return Date.now()-checked>VERIFY_MAX_AGE;
}

function recommendationRank(candidate){
  return {independent:4,page:3,watch:2,pending:1,reject:0,error:0}[candidate.seo?.classification||'pending']||0;
}

const sources=(await readJson(sourcesPath,[])).filter(source=>source.enabled!==false);
const radarState=await readJson(statePath,{snapshots:{},lastScan:null});
const candidatePayload=await readJson(candidatesPath,{candidates:[]});
const candidates=Array.isArray(candidatePayload)?candidatePayload:candidatePayload.candidates||[];
const now=new Date().toISOString();
const logs=[];
let totalAdded=0;

for(const source of sources){
  try{
    const result=await scanSource({...source,kind:source.fetchKind||(source.kind?.includes('sitemap')?'sitemap':source.kind?.includes('itch')?'itch-listing':source.kind||'auto')});
    const previous=radarState.snapshots[source.id];
    const previousUrls=new Set(previous?.urls||[]);
    const firstScan=!previous;
    const newEntries=firstScan&&source.baselineOnly?[]:result.entries.filter(entry=>!previousUrls.has(entry.url));
    const newUrls=new Set(newEntries.map(entry=>entry.url));
    let added=0;
    if(!(firstScan&&source.baselineOnly)){
      for(const entry of result.entries){const merged=mergeCandidate(candidates,entry.gameName,source,entry,now);if(merged&&newUrls.has(entry.url))added+=1}
    }
    totalAdded+=added;
    radarState.snapshots[source.id]={urls:result.entries.map(entry=>entry.url),scannedAt:result.scannedAt,detectedType:result.detectedType};
    logs.push({ok:true,sourceId:source.id,sourceName:source.name,total:result.entries.length,added});
    console.log(`✓ ${source.name}: ${result.entries.length} entries, ${added} new`);
  }catch(error){logs.push({ok:false,sourceId:source.id,sourceName:source.name,error:error.message});console.error(`✗ ${source.name}: ${error.message}`)}
}

for(const candidate of candidates)updateDiscovery(candidate);
const verifyQueue=candidates.filter(needsSeoCheck).sort((a,b)=>(b.discoveryScore||0)-(a.discoveryScore||0)||Date.parse(b.firstSeen)-Date.parse(a.firstSeen)).slice(0,VERIFY_LIMIT);
let seoVerified=0,seoErrors=0;
for(const candidate of verifyQueue){
  try{
    console.log(`SEO verify: ${candidate.gameName}`);
    candidate.seo=await verifyGameKeyword(candidate.gameName,candidate.discoveryScore||0);
    candidate.score=candidate.seo.score;
    candidate.level=candidate.seo.classification;
    seoVerified+=1;
  }catch(error){
    candidate.seo={checkedAt:new Date().toISOString(),status:'error',classification:'error',score:0,reasons:[`自动验证失败：${error.message}`]};
    candidate.score=0;candidate.level='error';seoErrors+=1;
    console.error(`SEO verify failed: ${candidate.gameName}: ${error.message}`);
  }
  await sleep(900);
}

for(const candidate of candidates){
  if(!candidate.seo){candidate.seo={status:'pending',classification:'pending',score:0,reasons:['等待自动搜索意图验证']};candidate.score=0;candidate.level='pending'}
}
candidates.sort((a,b)=>recommendationRank(b)-recommendationRank(a)||(b.seo?.score||0)-(a.seo?.score||0)||(b.discoveryScore||0)-(a.discoveryScore||0)||Date.parse(b.firstSeen)-Date.parse(a.firstSeen));
if(candidates.length>2500)candidates.length=2500;

const recommendationCounts={independent:0,page:0,watch:0,reject:0,pending:0,error:0};
for(const candidate of candidates)recommendationCounts[candidate.seo?.classification||'pending']=(recommendationCounts[candidate.seo?.classification||'pending']||0)+1;
radarState.lastScan=now;
await fs.writeFile(statePath,JSON.stringify(radarState,null,2)+'\n');
await fs.writeFile(candidatesPath,JSON.stringify({updatedAt:now,candidates},null,2)+'\n');
await fs.writeFile(reportPath,JSON.stringify({scannedAt:now,totalAdded,sources:logs,seoVerified,seoErrors,recommendationCounts},null,2)+'\n');
console.log(`Scan complete. ${totalAdded} names added; ${seoVerified} SEO checks completed; ${seoErrors} errors.`);
