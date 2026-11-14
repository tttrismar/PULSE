// Price job: reads tickers.txt, fetches each quote, writes prices.json.
// usage: node scripts/fetch-prices.mjs tickers.txt prices.json [previous-prices.json]
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {yahooSym, parseYahoo} from './quote.mjs';

const [,, listPath='tickers.txt', outPath='prices.json', prevPath]=process.argv;
const keys=[...new Set(readFileSync(listPath,'utf8').split(/\r?\n/).map(l=>l.replace(/#.*/,'').trim().toLowerCase())
  .filter(Boolean).map(s=>s.includes('.')? s : s+'.us'))];
let prev={}; try{ if(prevPath && existsSync(prevPath)) prev=JSON.parse(readFileSync(prevPath,'utf8')).quotes||{}; }catch(e){}

async function get(url){
  const r=await fetch(url,{headers:{'User-Agent':'pulse-price-job','Accept':'*/*'}, signal:AbortSignal.timeout(20000)});
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.text();
}
async function fromYahoo(key){
  return parseYahoo(JSON.parse(await get('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(yahooSym(key))+'?range=3mo&interval=1d')));
}
async function fromStooq(key){   // fallback source, daily closes only
  const rows=(await get('https://stooq.com/q/d/l/?s='+encodeURIComponent(key)+'&i=d')).trim().split(/\r?\n/).slice(1)
    .map(l=>l.split(',')).map(c=>({d:c[0], c:parseFloat(c[4])})).filter(x=>/^\d{4}-\d\d-\d\d$/.test(x.d) && !isNaN(x.c));
  if(rows.length<2) throw new Error('no rows');
  const uk=key.endsWith('.uk'), fix=n=>+(n*(uk?0.01:1)).toFixed(4), last=rows[rows.length-1];
  return { price:fix(last.c), prev:fix(rows[rows.length-2].c), cur:uk?'GBP':'USD', name:'', spark:rows.slice(-32).map(x=>fix(x.c)), asof:last.d };
}

const quotes={}; let ok=0;
for(const key of keys){
  let q=null, errs=[];
  for(const [name,fn] of [['yahoo',fromYahoo],['stooq',fromStooq]]){
    try{ q=await fn(key); q.src=name; break; }catch(e){ errs.push(name+': '+e.message); }
  }
  if(q){ ok++; if(!q.name && prev[key] && prev[key].name) q.name=prev[key].name; quotes[key]=q; console.log('ok  ', key, q.src, q.price, q.cur); }
  else { if(prev[key]) quotes[key]={...prev[key], stale:true}; console.log('FAIL', key, errs.join(' | ')); }
  await new Promise(r=>setTimeout(r,400));
}
if(!ok){ console.error('No prices fetched — leaving the published file as it is.'); process.exit(1); }
writeFileSync(outPath, JSON.stringify({updated:new Date().toISOString(), quotes}));
console.log('wrote', outPath, '-', ok, 'of', keys.length, 'tickers');
