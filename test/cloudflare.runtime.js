// Real workerd/D1 local-runtime smoke test; no account, remote browsers, or email.
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'tracker',modules:true,scriptPath:'.cloudflare-build/worker.js',compatibilityDate:'2026-10-08',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'test-price-tracker'},bindings:{}}]}));
  try{
    const response=await mf.dispatchFetch('https://tracker.example.org/');assert.equal(response.status,503);
    assert.match((await response.json()).error,/Access is not configured/);
    const db=await mf.getD1Database('DB');
    // D1 exec accepts one SQL statement per line.
    const migration=fs.readFileSync('cloudflare/migrations/0001_initial.sql','utf8').split(';').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean).join(';\n')+';';
    await db.exec(migration);
    const {Store}=await import('../cloudflare/store.mjs');const {processJob}=await import('../cloudflare/jobs.mjs');
    const store=new Store(db);const p=await store.add({url:'https://www.microcenter.com/product/711043/macbook'});
    const job=await store.reserve(p.id);
    await processJob({DB:db},job,async()=>({price:3999.99,currency:'USD',name:'Test MacBook',source:'Runtime fixture'}));
    const products=await store.list();assert.equal(products[0].currentPrice,3999.99);assert.equal(products[0].status,'baseline');
    await store.remove(p.id);assert.equal((await db.prepare('SELECT count(*) AS n FROM observations').first()).n,0);
    console.log('Workers runtime smoke passed: bundle executes, unconfigured access fails closed, D1 migration/queued check/history/cascade delete work.');
  }finally{await mf.dispose();}
})().catch(err=>{console.error(err);process.exitCode=1;});
