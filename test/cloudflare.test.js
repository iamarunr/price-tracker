const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// Execute the real migration and SQL against SQLite using the D1 method shape.
function database(t) {
  const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync('cloudflare/migrations/0001_initial.sql','utf8'));t.after(()=>db.close());
  const adapter={prepare(query){const stmt=db.prepare(query);return {bind(...args){return {
    async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},
    async run(){const value=stmt.run(...args);return {meta:{changes:Number(value.changes)}};}
  };}}},async batch(statements){db.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());db.exec('COMMIT');return results;}catch(err){db.exec('ROLLBACK');throw err;}}};
  return adapter;
}
const url='https://www.microcenter.com/product/711043/macbook?storeid=095';
const config={ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'test-audience',ALLOWED_EMAILS:'owner@example.org',ALLOWED_STORE_HOSTS:'microcenter.com,shop.example.org'};
const result=price=>({price,currency:'USD',name:'MacBook',source:'Test product'});
const imports=Promise.all([import('../cloudflare/store.mjs'),import('../cloudflare/jobs.mjs'),import('../cloudflare/worker.mjs'),import('../cloudflare/auth.mjs'),import('../cloudflare/scraper.mjs')]);

test('Worker Access fails closed when missing, spoofed, expired, wrong audience, or wrong email',async()=>{
  const [,,, {authorize}]=await imports;const {generateKeyPair,SignJWT,jwtVerify}=await import('jose');
  const request=token=>new Request('https://tracker.example.org/',{headers:token?{'Cf-Access-Jwt-Assertion':token}:{}});
  await assert.rejects(authorize(request(),{}),err=>err.status===503);
  await assert.rejects(authorize(request(),config),err=>err.status===401);
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const verifier=(token,keys,options)=>jwtVerify(token,publicKey,options);
  const sign=(email='owner@example.org',aud='test-audience',expires='5m')=>new SignJWT({email}).setProtectedHeader({alg:'RS256'}).setIssuedAt().setSubject('test-user').setIssuer('https://test.cloudflareaccess.com').setAudience(aud).setExpirationTime(expires).sign(privateKey);
  assert.equal(await authorize(request(await sign()),config,verifier),'owner@example.org');
  for(const token of ['spoofed',await sign('other@example.org'),await sign('owner@example.org','wrong'),await sign('owner@example.org','test-audience','-5m')])await assert.rejects(authorize(request(token),config,verifier),err=>err.status===403);
});
test('D1 queue coalesces requests and records baseline / same / dropped / increased',async t=>{
  const [{Store},{processJob}]=await imports;let clock=Date.now();const db=database(t),store=new Store(db,()=>clock);
  const env={...config,DB:db};const messages=[];const queue={send:async job=>messages.push(job)};
  const p=await store.add({url});
  for(const [price,status] of [[4000,'baseline'],[4000,'unchanged'],[3900,'dropped'],[3950,'increased']]){
    clock+=65000;await store.enqueue(p.id,queue);await store.enqueue(p.id,queue);assert.equal(messages.length,1);
    const job=messages.shift();await processJob(env,job,async()=>result(price));
    assert.equal((await store.list())[0].status,status);assert.equal((await store.list())[0].checking,false);
    await processJob(env,job,async()=>{throw Error('Duplicate delivery must not scrape');});
  }
  assert.equal((await store.get(p.id)).history.length,4);
});
test('cloud failures preserve prices, currency history, email state and retry eligibility',async t=>{
  const [{Store},{processJob}]=await imports;let clock=Date.now();const db=database(t),store=new Store(db,()=>clock),messages=[];
  const env={...config,DB:db,RESEND_API_KEY:'re_test',FROM_EMAIL:'sender@example.org',TO_EMAIL:'owner@example.org'};
  const p=await store.add({url,priceThreshold:4100});
  const check=async(scrape,send)=>{clock+=65000;await store.enqueue(p.id,{send:async job=>messages.push(job)});await processJob(env,messages.shift(),scrape,send);};
  await check(async()=>result(4000),async()=>{throw Error('Email rejected');});
  assert.equal((await store.get(p.id)).lastAlert,null);
  assert.equal((await store.get(p.id)).alertError,'Email rejected');
  await check(async()=>{throw Error('Store blocked');});
  assert.equal((await store.get(p.id)).history.length,1);assert.equal((await store.get(p.id)).lastError,'Store blocked');
  await check(async()=>({...result(1),currency:'EUR'}));assert.equal((await store.get(p.id)).history.length,1);
  let sends=0;await check(async()=>result(4000),async()=>{sends++;return 'sent';});
  await check(async()=>result(4000),async()=>{sends++;return 'sent';});
  assert.equal(sends,1);assert.equal((await store.get(p.id)).lastAlert.price,4000);
});
test('D1 records survive duplicate retry, target edits, and delete during an active check',async t=>{
  const [{Store},{processJob}]=await imports;const db=database(t),store=new Store(db);const p=await store.add({url});
  const job=await store.reserve(p.id),token=await store.claim(job);await store.record(job,token,result(4000));await store.release(job,token);
  await processJob({...config,DB:db},job,async()=>{throw Error('Already recorded, must reuse observation');});
  assert.equal((await store.get(p.id)).history.length,1);
  await store.update(p.id,{priceThreshold:3000});assert.equal((await store.get(p.id)).priceThreshold,3000);
  const second=await store.add({url:'https://shop.example.org/laptop'}),next=await store.reserve(second.id);
  await processJob({...config,DB:db},next,async()=>{await store.remove(second.id);return result(12);});
  assert.equal((await store.list()).length,1);
});
test('queue publication failure and expired leases recover without stuck checking status',async t=>{
  const [{Store}]=await imports;const db=database(t);let clock=Date.now();const store=new Store(db,()=>clock),p=await store.add({url});
  await assert.rejects(store.enqueue(p.id,{send:async()=>{throw Error('Queue unavailable');}}));
  assert.equal((await store.get(p.id)).checking,false);
  const original=await store.reserve(p.id);assert.ok(original);await store.claim(original);
  clock+=16*60000;
  assert.equal((await store.due()).length,1);const replacement=await store.reserve(p.id);assert.ok(replacement);assert.notEqual(replacement.jobId,original.jobId);
  assert.equal(await store.claim(original),null);assert.ok(await store.claim(replacement));
});
test('cloud URLs must match explicit retailer domains, including redirect/request restrictions',async()=>{
  const [,,,,{allowedStore,validateCloudUrl}]=await imports;
  assert.equal(allowedStore(url,config),true);assert.equal(allowedStore('https://www.microcenter.com/a',config),true);
  for(const value of ['http://microcenter.com/a','https://microcenter.com.evil.org/','https://127.0.0.1/a','https://example.org/','https://user:pass@microcenter.com/a','https://microcenter.com:8443/a'])assert.equal(allowedStore(value,config),false);
  assert.throws(()=>validateCloudUrl('https://unknown.example.org/p',config),/not enabled/);
});
test('Worker API integration: auth before assets, add, list, check, target, delete, cross-origin denial',async t=>{
  const [,,{createHandlers}]=await imports;const DB=database(t),jobs=[];
  const env={...config,DB,CHECKS:{send:async job=>jobs.push(job)},ASSETS:{fetch:async()=>new Response('dashboard')}};
  const worker=createHandlers({auth:async()=> 'owner@example.org',scrape:async()=>result(199)});
  const call=(route,method='GET',body,headers={})=>worker.fetch(new Request(`https://tracker.example.org${route}`,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}),env);
  assert.equal((await createHandlers().fetch(new Request('https://tracker.example.org/'),env)).status,401);
  assert.equal((await call('/')).status,200);
  assert.equal((await call('/','GET',undefined,{'Sec-Fetch-Site':'cross-site'})).status,200); // Access login redirect
  assert.equal((await call('/api/check','POST',{}, {'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await call('/api/products','POST',{url},{Origin:'https://evil.example'})).status,403);
  const added=await call('/api/products','POST',{url});assert.equal(added.status,201);const p=await added.json();assert.equal(jobs.length,1);
  let ack=0;await worker.queue({messages:[{body:jobs.shift(),ack:()=>ack++,retry:()=>assert.fail('Unexpected retry')}]},env);assert.equal(ack,1);
  let list=await (await call('/api/products')).json();assert.equal(list.runtime,'cloudflare');assert.equal(list.products[0].currentPrice,199);
  assert.equal((await call('/api/products','POST',{url})).status,409);
  assert.equal((await call(`/api/products/${p.id}`,'PATCH',{priceThreshold:150})).status,200);
  assert.equal((await call(`/api/products/${p.id}/check`,'POST',{})).status,202);
  assert.equal((await call('/api/products','POST',{url:'https://bad.example.org/p'})).status,400);
  assert.equal((await call(`/api/products/${p.id}`,'DELETE',{})).status,200);
  assert.equal((await (await call('/api/products')).json()).products.length,0);
});
test('scheduled handler queues due checks only after access setup',async t=>{
  const [{Store},,{createHandlers}]=await imports;const DB=database(t),store=new Store(DB);await store.add({url});
  const jobs=[],waits=[];const worker=createHandlers();const env={...config,DB,CHECKS:{send:async job=>jobs.push(job)}};
  await worker.scheduled({},env,{waitUntil:p=>waits.push(p)});await Promise.all(waits);assert.equal(jobs.length,1);
  await worker.scheduled({},env,{waitUntil:p=>waits.push(p)});await Promise.all(waits);assert.equal(jobs.length,1);
  await worker.scheduled({},{DB},{waitUntil:()=>assert.fail('Unconfigured schedule must not execute')});
});
test('Resend uses stable job idempotency key and records only accepted deliveries',async()=>{
  const [,{sendEmail}]=await imports;const product={name:'Laptop',priceThreshold:300,url,history:[{currency:'USD'}]};
  let options;
  assert.equal(await sendEmail({RESEND_API_KEY:'test'},product,200,'job-123',async(url,init)=>{options=init;return Response.json({id:'delivery'});}),'delivery');
  assert.equal(options.headers['Idempotency-Key'],'price-alert-job-123');
  await assert.rejects(sendEmail({},product,200,'job',async()=>Response.json({message:'rejected'},{status:400})),/rejected/);
});
