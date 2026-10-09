import { authorize, accessSettings } from './auth.mjs';
import { Store } from './store.mjs';
import { scrapeProduct, validateCloudUrl } from './scraper.mjs';
import { processJob, emailConfig, emailConfigured } from './jobs.mjs';
const security = {
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
function json(value,status=200) { return new Response(JSON.stringify(value),{status,headers:{...security,'Content-Type':'application/json; charset=utf-8'}}); }
async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw Object.assign(new Error('Send application/json.'),{status:415});
  const reader=request.body?.getReader();let raw='',length=0;
  if (reader) {
    const decoder=new TextDecoder();
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8192){await reader.cancel();throw Object.assign(new Error('Request is too large.'),{status:413});}raw+=decoder.decode(value,{stream:true});}
    raw+=decoder.decode();
  }
  let value;
  try {value=JSON.parse(raw||'{}');}catch{throw Object.assign(new Error('Invalid JSON.'),{status:400});}
  if(!value || Array.isArray(value) || typeof value!=='object')throw Object.assign(new Error('Send a JSON object.'),{status:400});
  return value;
}
export function createHandlers({auth=authorize,scrape=scrapeProduct}={}) {
  return {
    async fetch(request,env) {
      try {
        await auth(request,env); // Also protects static assets and direct workers.dev requests.
        const url=new URL(request.url);
        if (!['GET','HEAD'].includes(request.method)) {
          if (request.headers.get('Origin') && request.headers.get('Origin')!==url.origin) return json({error:'Cross-site requests are not allowed.'},403);
          if (request.headers.get('Sec-Fetch-Site')==='cross-site') return json({error:'Cross-site requests are not allowed.'},403);
        }
        if(!url.pathname.startsWith('/api/')){
          if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed.'},405);
          const response=await env.ASSETS.fetch(request);
          const headers=new Headers(response.headers);for(const [k,v] of Object.entries(security))headers.set(k,v);
          return new Response(response.body,{status:response.status,headers});
        }
        const store=new Store(env.DB);
        if(request.method==='GET' && url.pathname==='/api/products')return json({products:await store.list(),emailEnabled:emailConfigured(emailConfig(env)),intervalMinutes:60,runtime:'cloudflare'});
        const input=['POST','PATCH','DELETE'].includes(request.method)?await body(request):{};
        if(request.method==='POST' && url.pathname==='/api/products'){
          input.url=validateCloudUrl(input.url,env);
          const product=await store.add(input);
          try {await store.enqueue(product.id,env.CHECKS);}catch{ /* Saved product exposes queue error and remains retryable. */ }
          return json(product,201);
        }
        if(request.method==='POST' && url.pathname==='/api/check'){
          const products=await store.list();for(const p of products)await store.enqueue(p.id,env.CHECKS);
          return json({message:'Checks queued. Recently checked products have a one-minute cooldown.'},202);
        }
        const match=url.pathname.match(/^\/api\/products\/([\w-]+)(\/check)?$/);
        if(match){
          const id=match[1];
          if(request.method==='POST' && match[2]){await store.enqueue(id,env.CHECKS);return json({message:'Check queued, already pending, or checked within the last minute.'},202);}
          if(request.method==='PATCH' && !match[2])return json(await store.update(id,input));
          if(request.method==='DELETE' && !match[2]){await store.remove(id);return json({message:'Removed from watchlist.'});}
        }
        return json({error:'Not found.'},404);
      } catch(err) {
        const status=err.status || (/Enter |Use |invalid|target price/i.test(err.message)?400:500);
        if(status===500)console.error('Worker request failed:',err.message);
        return json({error:status===500?'The tracker could not complete this request. Check the Worker logs and database setup.':err.message},status);
      }
    },
    async scheduled(event,env,ctx) {
      if(!accessSettings(env))return; // Do not spend browser time before private setup is complete.
      const store=new Store(env.DB);
      ctx.waitUntil((async()=>{for(const {id} of await store.due())await store.enqueue(id,env.CHECKS);})());
    },
    async queue(batch,env) {
      if(!accessSettings(env)){batch.retryAll({delaySeconds:300});return;}
      for(const message of batch.messages){
        try{await processJob(env,message.body,scrape);message.ack();}
        catch(err){console.error('Check job failed:',err.message);message.retry({delaySeconds:60});}
      }
    }
  };
}
export default createHandlers();
