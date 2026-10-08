const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractProduct, money, validateProductUrl } = require('../lib/extract');
const { maybeAlert, sendAlertEmail } = require('../lib/alerts');
const { Tracker } = require('../lib/tracker');
const { publicAddress } = require('../lib/network');
const { createServer } = require('../server');
const url = 'https://www.microcenter.com/product/711043/macbook?storeid=095';
const config = { resendApiKey:'re_test',fromEmail:'sender@example.org',toEmail:'person@example.org',products:[] };
const result = price => ({price,currency:'USD',name:'MacBook Pro',source:'test fixture'});
function setup(t, scrape, custom={}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'price-tracker-test-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  return new Tracker({directory,config,scrape,send:async()=> 'delivery-id',...custom});
}

test('price parsing accepts full four-digit prices and rejects partial/malformed values',()=>{
  for(const text of ['$3999.99','3,999.99',3999.99,'3999.990000']) assert.equal(money(text),3999.99);
  for(const text of ['3999.99 per month','1,2','free',0,Infinity,'12.345']) assert.equal(money(text),null);
});
test('Micro Center selects the matching product, never a related product',()=>{
  const html='<h1>MacBook Pro</h1><div data-id="999" data-price="299.99"></div><div data-id="711043" data-price="3999.99"></div>';
  assert.equal(extractProduct(html,url).price,3999.99);
  assert.equal(extractProduct('<div class="product-price">$299.99</div>',url),null);
  assert.equal(extractProduct('<script>{"productPrice":"299.99"}</script>',url),null);
});
test('conflicting product prices and bot challenge pages are rejected',()=>{
  assert.equal(extractProduct('<div data-id="711043" data-price="3000"></div><div data-id="711043" data-price="3500"></div>',url),null);
  assert.equal(extractProduct('<title>Just a moment...</title><div data-id="711043" data-price="3000"></div>',url),null);
});
test('retired Micro Center listings cannot expose hidden catalog prices as current offers',()=>{
  const html='<div class="StandardSku ACnlc"><h1><span data-id="711043" data-price="5399.990000">MacBook</span></h1><p>No longer carried</p></div>';
  assert.equal(extractProduct(html,url),null);
});
test('other stores support graph/array structured data, exact page matching and currencies',()=>{
  const target='https://shop.example.org/laptop';
  const product={ '@type':'Product',name:'Laptop',url:target,offers:{price:'3999.99',priceCurrency:'EUR'} };
  for(const value of [product,[product],{'@graph':[product]}]) {
    const parsed=extractProduct(`<script type="application/ld+json">${JSON.stringify(value)}</script>`,target);
    assert.equal(parsed.price,3999.99);assert.equal(parsed.currency,'EUR');
  }
  product.url='https://shop.example.org/accessory';
  assert.equal(extractProduct(`<script type="application/ld+json">${JSON.stringify(product)}</script>`,target),null);
});
test('generic single product with matching canonical is supported, aggregate/ambiguous offers rejected',()=>{
  const target='https://shop.example.org/laptop';
  const render=offers=>`<link rel="canonical" href="${target}"><script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Laptop',offers})}</script>`;
  assert.equal(extractProduct(render({price:1299,priceCurrency:'USD'}),target).price,1299);
  assert.equal(extractProduct(render({lowPrice:999,highPrice:1499,priceCurrency:'USD'}),target),null);
  assert.equal(extractProduct(render([{price:999,priceCurrency:'USD'},{price:1499,priceCurrency:'USD'}]),target),null);
});
test('URL validation preserves store, strips trackers and disallows unsafe schemes',()=>{
  assert.equal(validateProductUrl(url+'&utm_source=x#details'),url);
  for(const value of ['file:///etc/passwd','http://shop.example.org/p','https://user:pass@example.org/p','https://localhost/p','https://example.org:8443/p']) assert.throws(()=>validateProductUrl(value));
});
test('network destinations exclude private addresses and IPv4-mapped IPv6',()=>{
  for(const ip of ['127.0.0.1','10.1.1.1','169.254.169.254','192.168.1.1','172.20.0.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1']) assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
});
test('dry runs do not send or create a delivery record',async()=>{
  let calls=0;
  const alert=await maybeAlert({product:{priceThreshold:4100},price:3999,config,dryRun:true,send:async()=>{calls++;}});
  assert.deepEqual(alert,{dryRun:true});assert.equal(calls,0);
});
test('Resend returned and thrown errors are failures; only a delivery ID is success',async()=>{
  const product={name:'Laptop',priceThreshold:4000,url};
  await assert.rejects(sendAlertEmail({emails:{send:async()=>({data:null,error:{message:'Invalid key'}})}},config,product,3900),/Invalid key/);
  await assert.rejects(sendAlertEmail({emails:{send:async()=>{throw Error('network');}}},config,product,3900),/network/);
  await assert.rejects(sendAlertEmail({emails:{send:async()=>({data:null,error:null})}},config,product,3900),/did not confirm/);
  assert.equal(await sendAlertEmail({emails:{send:async()=>({data:{id:'ok'},error:null})}},config,product,3900),'ok');
});
test('baseline, unchanged, dropped, increased, persistence and failed-check preservation',async t=>{
  let price=4000;
  const tracker=setup(t,async()=>{if(price===null)throw Error('Blocked');return result(price);});
  const p=tracker.add({url});
  assert.equal(tracker.list().products[0].status,'pending');
  for(const [value,status] of [[4000,'baseline'],[4000,'unchanged'],[3900,'dropped'],[3950,'increased']]) {
    price=value;await tracker.check(p.id);assert.equal(tracker.list().products[0].status,status);
  }
  price=null;await tracker.check(p.id);
  let saved=tracker.list().products[0];assert.equal(saved.currentPrice,3950);assert.equal(saved.delta,50);assert.equal(saved.lastError,'Blocked');assert.equal(saved.history.length,4);
  const restored=new Tracker({directory:path.dirname(tracker.file),config,scrape:async()=>result(1)});
  assert.equal(restored.list().products[0].currentPrice,3950);
});
test('failed email retries without losing observations; success deduplicates',async t=>{
  let sends=0,fail=true;
  const tracker=setup(t,async()=>result(3900),{send:async()=>{sends++;if(fail)throw Error('Rejected');return 'ok';}});
  const p=tracker.add({url,priceThreshold:4000});await tracker.check(p.id);
  assert.equal(tracker.find(p.id).lastAlert,null);assert.equal(tracker.find(p.id).history.length,1);
  fail=false;await tracker.check(p.id);await tracker.check(p.id);
  assert.equal(sends,2);assert.equal(tracker.find(p.id).lastAlert.price,3900);assert.equal(tracker.find(p.id).alertError,null);
});
test('concurrent checks serialize, same-product requests coalesce, deletion cannot resurrect product',async t=>{
  let finish,active=0,max=0;
  const tracker=setup(t,async()=>{active++;max=Math.max(max,active);await new Promise(r=>finish=r);active--;return result(100);});
  const a=tracker.add({url}), b=tracker.add({url:'https://shop.example.org/p'});
  const first=tracker.check(a.id);assert.equal(first,tracker.check(a.id));
  const second=tracker.check(b.id);
  await new Promise(r=>setImmediate(r));tracker.remove(a.id);finish();await first;
  await new Promise(r=>setImmediate(r));finish();await second;
  assert.equal(max,1);assert.equal(tracker.list().products.length,1);
});
test('legacy alert state is not imported; corrupt dashboard state is not overwritten',t=>{
  const tracker=setup(t,async()=>result(3900));
  fs.writeFileSync(path.join(path.dirname(tracker.file),'alert-state.json'),JSON.stringify({[url]:{price:1499.99}}));
  const p=tracker.add({url});assert.equal(tracker.find(p.id).lastAlert,null);
  fs.writeFileSync(tracker.file,'broken');assert.throws(()=>new Tracker({directory:path.dirname(tracker.file)}),/not been overwritten/);
  assert.equal(fs.readFileSync(tracker.file,'utf8'),'broken');
});
test('currency changes cannot corrupt comparisons',async t=>{
  let currency='USD';const tracker=setup(t,async()=>({...result(100),currency}));const p=tracker.add({url});await tracker.check(p.id);currency='EUR';await tracker.check(p.id);
  assert.equal(tracker.find(p.id).history.length,1);assert.match(tracker.find(p.id).lastError,/currency changed/);
});
test('API supports add, queued check, update, delete and same-origin restrictions',async t=>{
  const tracker=setup(t,async()=>result(4000));const server=createServer(tracker);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(route,method='GET',body={},headers={})=>fetch(base+route,{method,headers:{'Content-Type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})});
  assert.equal((await fetch(base+'/config.json')).status,404);
  assert.equal((await call('/api/products','POST',{url},{Origin:'https://evil.example'})).status,403);
  const add=await call('/api/products','POST',{url});assert.equal(add.status,201);const p=await add.json();await tracker.queue;
  assert.equal((await call('/api/products','POST',{url})).status,409);
  assert.equal((await call(`/api/products/${p.id}`,'PATCH',{priceThreshold:3500})).status,200);
  assert.equal((await (await call('/api/products')).json()).products[0].currentPrice,4000);
  assert.equal((await call('/api/check','POST')).status,202);await tracker.queue;
  assert.equal((await call(`/api/products/${p.id}`,'DELETE')).status,200);
  assert.equal(tracker.list().products.length,0);
});

test('hourly scheduling checks pending and overdue products without rechecking recent observations',async t=>{
  let now=new Date('2026-10-08T12:00:00Z'),calls=0;
  const tracker=setup(t,async()=>{calls++;return result(100);},{now:()=>now});tracker.add({url});
  await tracker.checkDue();assert.equal(calls,1);
  now=new Date('2026-10-08T12:59:59Z');await tracker.checkDue();assert.equal(calls,1);
  now=new Date('2026-10-08T13:00:00Z');await tracker.checkDue();assert.equal(calls,2);
});
