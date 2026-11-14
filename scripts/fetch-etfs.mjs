// ETF performance job: reads etfs.txt, fetches each fund's full daily price and dividend history, and writes
// the returns the Analysis tab ranks plus a month-end total-return series for the children's planner tabs. Long history changes slowly, so this only refetches
// when the list changes or the previous file is older than MAX_AGE_H hours.
// usage: node scripts/fetch-etfs.mjs etfs.txt etfs.json [previous-etfs.json]
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {yahooSym} from './quote.mjs';

const MAX_AGE_H=20;
const [,, listPath='etfs.txt', outPath='etfs.json', prevPath]=process.argv;
const list=readFileSync(listPath,'utf8').split(/\r?\n/).map(l=>l.replace(/#.*/,'').trim()).filter(Boolean).map(l=>{
  const [t,cat]=l.split(',').map(x=>x.trim()); const key=t.toLowerCase();
  return {key:key.includes('.')? key : key+'.us', cat:cat||'Other'};
});
const sig='v3:'+list.map(e=>e.key+'|'+e.cat).join(',');   // bump the version when the calculation changes
let prev=null; try{ if(prevPath && existsSync(prevPath)) prev=JSON.parse(readFileSync(prevPath,'utf8')); }catch(e){}
if(prev && prev.sig===sig && Date.now()-Date.parse(prev.updated)<MAX_AGE_H*3600e3){
  writeFileSync(outPath, JSON.stringify(prev)); console.log('ETF data is fresh (', prev.updated, ') — reused'); process.exit(0);
}

const iso=d=>d.toISOString().slice(0,10);
async function history(key){
  const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(yahooSym(key))+'?period1=0&period2='+Math.floor(Date.now()/1000)+'&interval=1d&events=div';
  const r=await fetch(url,{headers:{'User-Agent':'pulse-price-job','Accept':'*/*'}, signal:AbortSignal.timeout(60000)});
  if(!r.ok) throw new Error('HTTP '+r.status);
  const res=(await r.json()).chart.result[0], m=res.meta, ts=res.timestamp||[], off=(m.gmtoffset||0)*1000;
  const close=res.indicators.quote[0].close;
  let rows=[]; ts.forEach((t,i)=>{ if(close[i]!=null && close[i]>0) rows.push({t, d:iso(new Date(t*1000+off)), p:close[i]}); });
  if(rows.length<30) throw new Error('too little history');
  // some London lines flip between pence and pounds in the source: undo x100 jumps
  let k=1; for(let i=1;i<rows.length;i++){ const ratio=rows[i].p*k/rows[i-1].p; if(ratio>50) k/=100; else if(ratio<0.02) k*=100; rows[i].p*=k; }
  // Total return with dividends reinvested on the ex-dividend day. Worked out here from the raw prices and
  // dividend records, because the source's own adjusted series under-counts dividends on pence-quoted funds.
  const divs=Object.values((res.events||{}).dividends||{}).sort((x,y)=>x.date-y.date); let di=0;
  rows[0].c=rows[0].p;
  while(di<divs.length && divs[di].date<=rows[0].t) di++;
  for(let i=1;i<rows.length;i++){
    let paid=0;
    while(di<divs.length && divs[di].date<=rows[i].t+86399){ let a=divs[di].amount||0; if(a/rows[i].p>0.2) a/=100; paid+=a; di++; }
    rows[i].c=rows[i-1].c*(rows[i].p+paid)/rows[i-1].p;
  }
  return {rows, name:m.longName||m.shortName||'', cur:(m.currency==='GBp'||m.currency==='GBX')?'GBP':(m.currency||'')};
}
function returns(rows){
  const last=rows[rows.length-1], first=rows[0], pct=(a,b)=>+((a/b-1)*100).toFixed(2);
  const onOrBefore=d=>{ let lo=0, hi=rows.length-1, ans=null; while(lo<=hi){ const mid=(lo+hi)>>1; if(rows[mid].d<=d){ ans=rows[mid]; lo=mid+1; } else hi=mid-1; } return ans; };
  const r={}, y={}, end=new Date(last.d+'T00:00:00Z');
  for(const n of [1,3,5,10]){
    // the fund must already have been trading at the start of the period (allow a week for holidays)
    const s=new Date(end); s.setUTCFullYear(s.getUTCFullYear()-n); const base=onOrBefore(iso(s));
    const start=iso(s), gap=d=>Math.abs(Date.parse(start)-Date.parse(d))<8*864e5;
    r[n+'y']= base && gap(base.d)? pct(last.c, base.c) : (!base && gap(first.d)? pct(last.c, first.c) : null);
  }
  const thisYear=end.getUTCFullYear();
  for(let yr=thisYear; yr>=thisYear-9; yr--){
    const base=onOrBefore((yr-1)+'-12-31'), fin= yr===thisYear? last : onOrBefore(yr+'-12-31');
    const ok= base && fin && base.d>=(yr-1)+'-12-20';
    if(yr===thisYear) r.ytd= ok? pct(fin.c, base.c) : null; else if(ok) y[yr]=pct(fin.c, base.c);
  }
  // month-end total-return index (first month = 100), complete months only — used for monthly-investing backtests
  const ends=[]; for(let i=0;i<rows.length;i++){ const ym=rows[i].d.slice(0,7); if(i+1<rows.length && rows[i+1].d.slice(0,7)===ym) continue; if(i+1<rows.length) ends.push({ym, c:rows[i].c}); }
  const v=[]; let cur=ends.length? ends[0].ym : '';
  for(const e of ends){ while(cur<e.ym){ v.push(v.length? v[v.length-1] : 100); let [Y,M]=cur.split('-').map(Number); M++; if(M>12){ M=1; Y++; } cur=Y+'-'+String(M).padStart(2,'0'); }
    v.push(+(e.c/ends[0].c*100).toFixed(3)); let [Y,M]=cur.split('-').map(Number); M++; if(M>12){ M=1; Y++; } cur=Y+'-'+String(M).padStart(2,'0'); }
  return {r, y, since:first.d, asof:last.d, m: ends.length>12? {s:ends[0].ym, v} : null};
}

const funds=[]; let ok=0;
for(const e of list){
  try{
    const h=await history(e.key);
    funds.push({key:e.key, sym:e.key.replace(/\.(uk|us)$/,'').toUpperCase(), cat:e.cat, name:h.name, cur:h.cur, ...returns(h.rows)});
    ok++; console.log('ok  ', e.key, h.rows.length, 'days', h.name);
  }catch(err){
    const old=prev && prev.funds && prev.funds.find(f=>f.key===e.key); if(old) funds.push({...old, cat:e.cat});
    console.log('FAIL', e.key, err.message);
  }
  await new Promise(r=>setTimeout(r,500));
}
if(!ok){
  if(prev){ writeFileSync(outPath, JSON.stringify(prev)); console.log('No ETF data fetched — kept the previous file.'); process.exit(0); }
  console.error('No ETF data fetched.'); process.exit(1);
}
writeFileSync(outPath, JSON.stringify({updated:new Date().toISOString(), sig, funds}));
console.log('wrote', outPath, '-', ok, 'of', list.length, 'funds');
