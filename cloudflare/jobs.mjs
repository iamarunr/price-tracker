import alerts from '../lib/alerts.js';
import { Store } from './store.mjs';
const { emailConfigured, maybeAlert } = alerts;
export function emailConfig(env) {
  return {resendApiKey:env.RESEND_API_KEY,fromEmail:env.FROM_EMAIL,toEmail:env.TO_EMAIL};
}
export async function sendEmail(env, product, price, jobId, fetcher=fetch) {
  const currency = product.history.at(-1)?.currency || 'USD';
  const money = value=>new Intl.NumberFormat('en-US',{style:'currency',currency}).format(value);
  const response = await fetcher('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`price-alert-${jobId}`},
    body:JSON.stringify({from:env.FROM_EMAIL,to:env.TO_EMAIL,subject:`Price drop: ${product.name} — ${money(price)}`,
      text:`${product.name}\nCurrent price: ${money(price)}\nAlert target: ${money(product.priceThreshold)}\n\n${product.url}`}),
    signal:AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok || !result.id) throw new Error('Email service rejected the alert. Check the Worker email settings.');
  return result.id;
}
export async function processJob(env, job, scrape, send=sendEmail) {
  if (!job || typeof job.id!=='string' || typeof job.jobId!=='string') return;
  const store = new Store(env.DB);
  const token = await store.claim(job);
  if (!token) return;
  try {
    let result = await store.previousResult(job);
    if (!result) {
      let scrapeError;
      try {
        const product = await store.get(job.id);
        result = await scrape(product.url,env);
        if (!result || !Number.isFinite(result.price) || result.price<=0 || !/^[A-Z]{3}$/.test(result.currency)) throw new Error('The store did not return a valid price and currency.');
        if (product.history.at(-1)?.currency && product.history.at(-1).currency!==result.currency) throw new Error('The store currency changed. Remove and re-add this product to start a new history.');
      } catch (err) { scrapeError=err.message; }
      if (scrapeError) { await store.complete(job,token,{error:scrapeError}); return; }
      if (!await store.owns(job,token)) return;
      await store.record(job,token,result);
    }
    if (!await store.owns(job,token)) return;
    const product = await store.get(job.id);
    let alert=null, alertError=null;
    try {
      alert = await maybeAlert({product,price:result.price,config:emailConfig(env),previous:product.lastAlert,
        send:(p,price)=>send(env,p,price,job.jobId)});
    } catch (err) { alertError=err.message; }
    await store.complete(job,token,{alert,alertError});
  } catch (err) {
    await store.release(job,token).catch(()=>{});
    throw err; // Infrastructure failures retry through the durable queue.
  }
}
export { emailConfigured };
