// Shared by the price job. The same two functions are copied into index.html — keep them in step.

// Pulse key (aapl.us, smt.uk, bt.a.uk) -> Yahoo symbol (AAPL, SMT.L, BT-A.L)
export function yahooSym(key){
  const i=key.lastIndexOf('.'); const base=key.slice(0,i).toUpperCase().replace(/\./g,'-'), mkt=key.slice(i+1);
  return mkt==='us'? base : mkt==='uk'? base+'.L' : base+'.'+mkt.toUpperCase();
}

// Yahoo chart response (range=3mo, interval=1d) -> {price, prev, cur, name, asof, spark}
export function parseYahoo(j){
  const r=j && j.chart && j.chart.result && j.chart.result[0]; if(!r || !r.meta) throw new Error('no result');
  const m=r.meta, ts=r.timestamp||[], cl=((r.indicators||{}).quote||[{}])[0].close||[], off=(m.gmtoffset||0)*1000;
  const day=t=>new Date(t*1000+off).toISOString().slice(0,10);
  const rows=[]; ts.forEach((t,i)=>{ if(cl[i]!=null) rows.push({d:day(t), c:cl[i]}); });
  let price=m.regularMarketPrice; if(price==null && rows.length) price=rows[rows.length-1].c;
  if(price==null) throw new Error('no price');
  const today=m.regularMarketTime? day(m.regularMarketTime) : (rows.length? rows[rows.length-1].d : '');
  const before=rows.filter(x=>x.d<today);
  let prev=before.length? before[before.length-1].c : null;
  let spark=before.slice(-31).map(x=>x.c).concat([price]);
  let cur=m.currency||'USD', k=1;
  if(cur==='GBp'||cur==='GBX'){ cur='GBP'; k=0.01; }   // London prices come in pence
  const fix=n=>n==null? null : +(n*k).toFixed(4);
  return { price:fix(price), prev:fix(prev), cur, name:m.shortName||m.longName||'', spark:spark.map(fix),
    asof:m.regularMarketTime? new Date(m.regularMarketTime*1000).toISOString() : '' };
}
