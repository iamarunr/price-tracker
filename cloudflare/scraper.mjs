import puppeteer from '@cloudflare/puppeteer';
import extractor from '../lib/extract.js';
const { validateProductUrl, unavailableReason, extractProduct } = extractor;
export function storeHosts(env) {
  return String(env.ALLOWED_STORE_HOSTS || '').split(',').map(h=>h.trim().toLowerCase()).filter(h=>/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(h));
}
export function allowedStore(input, env) {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      storeHosts(env).some(host=>url.hostname===host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}
export function validateCloudUrl(input, env) {
  const url = validateProductUrl(input);
  if (!allowedStore(url,env)) throw Object.assign(new Error('This store is not enabled for the hosted tracker. Add its domain to ALLOWED_STORE_HOSTS in the Worker settings.'),{status:400});
  return url;
}
export async function scrapeProduct(input, env) {
  const url = validateCloudUrl(input,env);
  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(35000);
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request',request=>{
      const blocked = ['image','media','font'].includes(request.resourceType()) || !allowedStore(request.url(),env);
      (blocked ? request.abort() : request.continue()).catch(()=>{});
    });
    const response = await page.goto(url,{waitUntil:'domcontentloaded'});
    if (!allowedStore(page.url(),env)) throw new Error('The product redirected outside the enabled stores.');
    if (!response || response.status()>=400) throw new Error(`The store returned HTTP ${response?.status() || 'error'}. Try again later.`);
    await page.waitForSelector('h1, script[type="application/ld+json"], [data-price]',{timeout:10000}).catch(()=>{});
    const html = await page.content();
    const unavailable = unavailableReason(html,url);
    if (unavailable) throw new Error(unavailable);
    const result = extractProduct(html,url);
    if (!result) throw new Error('Could not verify this product’s price. The store may block cloud browsers or omit readable price data. The last valid price is preserved.');
    return result;
  } finally { if (browser) await browser.close().catch(()=>{}); }
}
