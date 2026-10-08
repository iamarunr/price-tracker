// Browser acceptance checks use synthetic prices, a mock scraper and temporary storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Tracker } = require('../lib/tracker');
const { createServer } = require('../server');

(async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'price-tracker-browser-'));
  const out=path.join(__dirname,'..','.impeccable','review');fs.mkdirSync(out,{recursive:true});
  const prices=new Map();
  const tracker=new Tracker({directory,config:{products:[]},scrape:async url=>({price:prices.get(url)||99.99,currency:'USD',name:'Fixture product',source:'Browser test fixture'})});
  const seed=(name,slug,values,error=null)=>{
    const p=tracker.add({url:`https://store.example.org/${slug}`,name});
    const product=tracker.find(p.id);
    product.history=values.map((price,i)=>({price,currency:'USD',at:new Date(Date.UTC(2026,9,8,12+i)).toISOString(),source:'Synthetic test data'}));
    product.lastAttemptAt=product.history.at(-1)?.at||null;product.lastError=error;
    return product;
  };
  const mac=seed('MacBook Pro 16-inch · Silver','macbook',[4130.99,4130.99,3999.99]);mac.priceThreshold=4000;
  seed('Sony WH-1000XM6 Wireless Headphones','headphones',[399.99,399.99]);
  seed('Dell UltraSharp 27-inch 4K Monitor','monitor',[449.99,479.99]);
  seed('Logitech MX Master 4','mouse',[119.99],'The store could not verify this price. Try again later.');
  tracker.save();
  const server=createServer(tracker);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const {default:puppeteer}=await import('puppeteer');
  let browser;
  try{
    browser=await puppeteer.launch({channel:'chrome',headless:true});
    const page=await browser.newPage();const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:1440,height:1100,deviceScaleFactor:1});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForSelector('.product');
    await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.$$eval('.product',els=>els.length),4);
    await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
    await page.click('[data-filter="dropped"]');assert.equal(await page.$$eval('.product',els=>els.length),1);
    await page.click('[data-filter="unchanged"]');assert.equal(await page.$$eval('.product',els=>els.length),1);
    await page.click('[data-filter="increased"]');assert.equal(await page.$$eval('.product',els=>els.length),1);
    await page.click('[data-filter="attention"]');assert.equal(await page.$$eval('.product',els=>els.length),1);
    await page.click('[data-filter="all"]');
    await page.click(`.product-name[data-id="${mac.id}"]`);
    assert.match(await page.$eval('.detail',el=>el.textContent),/Price history/);
    await page.$eval('.target-input',el=>{el.value='3800';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.click('.target-form button');
    await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('target saved'));
    assert.equal(tracker.find(mac.id).priceThreshold,3800);
    await page.setViewport({width:390,height:844,deviceScaleFactor:1});
    await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,'Mobile must not overflow');
    await page.type('#product-url','https://store.example.org/new-product');
    await page.click('#add-button');
    await page.waitForFunction(()=>document.querySelector('#product-count').textContent==='5');
    await page.waitForFunction(()=>document.querySelector('.detail')?.textContent.includes('first price is saved'));
    assert.equal(tracker.state.products.length,5);
    await page.click('[data-action="remove"]');await page.click('[data-action="confirm-remove"]');
    await page.waitForFunction(()=>document.querySelector('#product-count').textContent==='4');
    // Duplicate errors stay in the form and preserve the watchlist.
    await page.type('#product-url',mac.url);await page.click('#add-button');
    await page.waitForFunction(()=>!document.querySelector('#form-error').hidden);
    assert.match(await page.$eval('#form-error',el=>el.textContent),/already/);
    await page.type('#search','nothing matches');assert.match(await page.$eval('#products',el=>el.textContent),/No matching/);
    await page.click('[data-action="clear"]');
    await page.setViewport({width:1024,height:768,deviceScaleFactor:1});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,'Tablet must not overflow');
    await page.screenshot({path:path.join(out,'tablet.png'),fullPage:true});
    tracker.state.products=[];tracker.save();await page.reload();
    await page.waitForFunction(()=>document.querySelector('#products').textContent.includes('Your next good deal'));
    await page.screenshot({path:path.join(out,'empty.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('Browser checks passed: filters, history, target, add/check, remove, duplicate, search, empty state, responsive overflow, no JS errors.');
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
})().catch(err=>{console.error(err);process.exitCode=1;});
