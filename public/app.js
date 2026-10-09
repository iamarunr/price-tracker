'use strict';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icons = {
  down: '<path d="M12 4v16m-6-6 6 6 6-6"/>', up: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  same: '<path d="M5 9h14M5 15h14"/>', chevron: '<path d="m6 9 6 6 6-6"/>',
  external: '<path d="M14 4h6v6m0-6L10 14M10 4H4v16h16v-6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ''}</svg>`;
const labels = { dropped: 'Dropped', increased: 'Increased', unchanged: 'Unchanged', baseline: 'First price', pending: 'Not checked' };
let data = {products:[],emailEnabled:false};
let filter = 'all', query = '', expanded = null, signature = '', removing = null, fetching = false;
let targetDrafts = new Map();
let disconnected = false;
const formatPrice = (price, currency = 'USD') => price === null || price === undefined ? '—' : new Intl.NumberFormat(undefined, {style:'currency',currency:currency || 'USD'}).format(price);
const date = value => value ? new Date(value).toLocaleString(undefined, {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Never';
const shortDate = value => new Date(value).toLocaleDateString(undefined, {month:'short',day:'numeric'});
function notice(message, bad = false) { $('#notice').textContent = message; $('#notice').hidden = !message; $('#notice').className = `notice${bad?' bad':''}`; }
async function api(path, method = 'GET', body) {
  const response = await fetch(path, {method,headers:method === 'GET' ? {} : {'Content-Type':'application/json'},body: method === 'GET' ? undefined : JSON.stringify(body || {})});
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || 'Something went wrong. Try again.'), {status:response.status});
  return value;
}
function historyChart(product) {
  const history = product.history;
  if (history.length < 2) return `<div class="no-history">${history.length ? 'Your first price is saved. Check again later to start comparing.' : 'The first successful check will start your price history.'}</div>`;
  const points = history.slice(-60);
  const values = points.map(p => p.price);
  const low = Math.min(...values), high = Math.max(...values), pad = Math.max((high-low)*.2,high*.01,1);
  const min = low-pad, max = high+pad;
  const start = Date.parse(points[0].at), end = Date.parse(points.at(-1).at);
  const x = (p,i) => 85 + (end === start ? i/(points.length-1) : (Date.parse(p.at)-start)/(end-start))*510;
  const y = p => 125-(p.price-min)/(max-min)*100;
  return `<svg class="chart" viewBox="0 0 620 165" role="img" aria-label="${esc(`Last ${points.length} price observations, from ${formatPrice(points[0].price,product.currency)} to ${formatPrice(points.at(-1).price,product.currency)}. Full values are in the table below.`)}">
    <line class="axis" x1="85" y1="25" x2="595" y2="25"/><line class="axis" x1="85" y1="125" x2="595" y2="125"/>
    <text x="0" y="29">${esc(formatPrice(max,product.currency))}</text><text x="0" y="129">${esc(formatPrice(min,product.currency))}</text>
    <polyline class="series" points="${points.map((p,i)=>`${x(p,i)},${y(p)}`).join(' ')}"/>
    <circle class="point" cx="${x(points.at(-1),points.length-1)}" cy="${y(points.at(-1))}" r="4"/>
    <text x="85" y="155">${esc(shortDate(points[0].at))}</text><text x="595" y="155" text-anchor="end">${esc(shortDate(points.at(-1).at))}</text>
  </svg>`;
}
function detail(product) {
  const id = product.id;
  return `<div class="detail" id="detail-${esc(id)}"><div class="detail-inner"><div><h3>Price history</h3>
    <div class="history-summary"><span>First seen <strong>${esc(formatPrice(product.history[0]?.price,product.currency))}</strong></span><span>Lowest recorded <strong>${esc(formatPrice(product.lowestPrice,product.currency))}</strong></span></div>
    ${historyChart(product)}
    ${product.history.length ? `<details><summary class="text-button">See recorded prices (${product.history.length})</summary><div class="history-log"><table class="history-table"><thead><tr><th scope="col">Checked at</th><th scope="col">Price</th></tr></thead><tbody>${[...product.history].reverse().map(h=>`<tr><td>${esc(date(h.at))}</td><td>${esc(formatPrice(h.price,h.currency))}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    <p class="subtext">${product.history.length ? `Verified from ${esc(product.history.at(-1).source)}. Up to 2,000 recent checks are kept.` : 'No verified price yet.'}</p></div>
    <div class="detail-settings"><form class="target-form" data-id="${esc(id)}"><label class="target-label" for="target-${esc(id)}">Email alert below${product.currency ? ` (${esc(product.currency)})` : ''}</label><input class="target-input" id="target-${esc(id)}" type="number" min="0.01" step="0.01" max="100000000" placeholder="Optional target price" value="${esc(targetDrafts.has(id) ? targetDrafts.get(id) : product.priceThreshold ?? '')}"><button class="button secondary" type="submit">Save target</button></form><p class="help">${data.emailEnabled ? 'Email is sent below your target, then only for further drops.' : (data.runtime === 'cloudflare' ? 'Optional. Enable email alerts in your Worker settings. Tracking works without email.' : 'Optional. To send emails, configure Resend in config.json. Tracking works without it.')}</p>
    ${product.alertError ? `<p class="error-text">Email failed: ${esc(product.alertError)}. It will retry on the next check.</p>` : ''}
    <div class="detail-actions"><button class="text-button" data-action="check" data-id="${esc(id)}" ${product.checking?'disabled':''}>${product.checking?'Checking…':'Check now'}</button>${removing === id ? `<button class="text-button danger" data-action="confirm-remove" data-id="${esc(id)}">Confirm removal</button><button class="text-button" data-action="cancel-remove" data-id="${esc(id)}">Cancel</button>` : `<button class="text-button danger" data-action="remove" data-id="${esc(id)}">Remove</button>`}</div></div></div></div>`;
}
function render() {
  const active = document.activeElement;
  const focusId = active?.id;
  const action = active?.dataset.action, actionId = active?.dataset.id;
  $('#product-count').textContent = data.products.length;
  const hosted = data.runtime === 'cloudflare';
  $('.local-label').textContent = hosted ? 'CLOUD' : 'LOCAL';
  $('.schedule').innerHTML = hosted ? '<span class="dot"></span>Hourly cloud checks' : '<span class="dot"></span>Checks every hour<span class="desktop-only"> · while running</span>';
  $('#storage-label').textContent = hosted ? 'Saved in your private cloud database' : 'Stored on this device';
  $('#email-status').textContent = data.emailEnabled ? 'Email alerts enabled' : 'Email alerts not configured';
  const running = data.products.some(p=>p.checking);
  $('#check-all').disabled = !data.products.length || running;
  $('#check-all span').textContent = running ? 'Checking prices…' : 'Check all prices';
  const products = data.products.filter(p => (filter === 'all' || (filter === 'attention' ? p.lastError || p.alertError : p.status === filter)) && `${p.name} ${p.url}`.toLowerCase().includes(query));
  $('#products').setAttribute('aria-busy','false');
  if (!products.length) {
    $('#products').innerHTML = data.products.length ? '<div class="empty"><h3>No matching products</h3><p>Try another filter or search term.</p><button class="button secondary" data-action="clear">Clear filters</button></div>' : '<div class="empty"><h3>Your next good deal starts here</h3><p>Paste a product link above. We’ll save its first price and keep track of what changes.</p><button class="button secondary" data-action="add-focus">Add your first product</button></div>';
    return;
  }
  $('#products').innerHTML = `<div class="column-head" aria-hidden="true"><span>Product</span><span>Latest price</span><span>Price change</span><span>Last checked</span><span></span></div>`+products.map(p=>{
    const currency = p.currency || 'USD';
    const delta = p.delta === null ? null : `${p.delta > 0 ? '+' : p.delta < 0 ? '−' : ''}${formatPrice(Math.abs(p.delta),currency)}`;
    const host = new URL(p.url).hostname.replace(/^www\./,'');
    const trendIcon = p.status === 'dropped' ? 'down' : p.status === 'increased' ? 'up' : p.status === 'unchanged' ? 'same' : null;
    return `<article class="product" aria-label="${esc(p.name)}"><div class="product-row"><div class="product-info"><button class="product-name" data-action="expand" data-id="${esc(p.id)}" aria-expanded="${expanded===p.id}" aria-controls="detail-${esc(p.id)}">${esc(p.name)}</button><div class="store"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(host)} ${icon('external')}</a>${new URL(p.url).searchParams.get('storeid') ? ` · Store ${esc(new URL(p.url).searchParams.get('storeid'))}` : ''}</div></div>
    <div class="price-cell"><div class="price">${esc(formatPrice(p.currentPrice,currency))}${p.currency ? `<small>${esc(p.currency)}</small>` : ''}</div><div class="subtext">${p.lastError && p.checkedAt ? 'Last verified price' : p.priceThreshold ? `Target ${esc(formatPrice(p.priceThreshold,currency))}` : 'No target set'}</div></div>
    <div class="change-cell"><span class="status ${esc(p.status)}">${trendIcon?icon(trendIcon):''}${labels[p.status]}</span><div class="subtext">${delta !== null ? `${esc(delta)}${p.previousPrice ? ` (${Math.abs(p.delta/p.previousPrice*100).toFixed(1)}%)` : ''}` : p.status === 'baseline' ? 'Comparison starts next check' : 'Waiting for a first price'}</div></div>
    <div class="check-cell"><div class="last-check">${p.checking ? 'Checking…' : esc(date(p.checkedAt))}</div><div class="subtext">${p.lastError ? '<span class="status error">Check failed</span>' : p.checking ? 'Queued or fetching price' : p.checkedAt ? 'Automatically every hour' : 'Ready when you are'}</div></div>
    <button class="icon-button expand" data-action="expand" data-id="${esc(p.id)}" aria-label="${expanded === p.id?'Hide':'Show'} history for ${esc(p.name)}" aria-expanded="${expanded === p.id}" aria-controls="detail-${esc(p.id)}">${icon('chevron')}</button></div>
    ${p.lastError ? `<div class="check-error"><strong>We couldn’t verify the latest price.</strong>${esc(p.lastError)} <button class="text-button" data-action="check" data-id="${esc(p.id)}" ${p.checking?'disabled':''}>Try again</button></div>` : ''}
    ${expanded === p.id ? detail(p) : `<div id="detail-${esc(p.id)}" hidden></div>`}</article>`;
  }).join('');
  if (focusId) document.getElementById(focusId)?.focus({preventScroll:true});
  else if (action && actionId) [...document.querySelectorAll('[data-action]')].find(el=>el.dataset.action===action && el.dataset.id===actionId)?.focus({preventScroll:true});
}
async function refresh(force = false) {
  if (fetching) return;
  fetching = true;
  try {
    const next = await api('/api/products');
    // Exclude changing next-check projections from UI reconciliation.
    const nextSignature = JSON.stringify(next,(key,value)=>key==='nextCheckAt'?undefined:value);
    const prior = new Map(data.products.map(p=>[p.id,p.checkedAt]));
    data = next;
    if (force || nextSignature !== signature) {
      signature = nextSignature; render();
      data.products.filter(p=>p.checkedAt && prior.has(p.id) && prior.get(p.id)!==p.checkedAt).forEach(p=>{
        const button = [...document.querySelectorAll('.product-name')].find(el=>el.dataset.id===p.id);
        button?.closest('article').classList.add('new-price');
      });
    }
    $('#sync-status').textContent = 'Connected';
    if (disconnected) { notice('Connection restored.'); disconnected = false; }
  } catch (err) {
    $('#sync-status').textContent = 'Disconnected';
    disconnected = true;
    notice(err.status ? err.message : 'Cannot reach the tracker. Check your connection, then retry. Your saved prices are unchanged.',true);
    $('#products').setAttribute('aria-busy','false');
    if (!signature) $('#products').innerHTML = '<div class="empty"><h3>Couldn’t load your watchlist</h3><p>Check your connection or sign-in session, then retry.</p><button class="button secondary" data-action="retry">Retry connection</button></div>';
  } finally { fetching = false; }
}
$('#add-form').addEventListener('submit',async event=>{
  event.preventDefault(); $('#form-error').hidden = true; const button = $('#add-button'); button.disabled = true; button.textContent = 'Adding…';
  try {
    const product = await api('/api/products','POST',{url:$('#product-url').value.trim()});
    $('#product-url').value=''; filter='all'; query=''; $('#search').value=''; updateFilters(); expanded=product.id;
    notice('Product added. Its first price check is queued; this can take a few minutes.');
    await refresh(true);
  } catch(err) { $('#form-error').textContent=err.message; $('#form-error').hidden=false; }
  finally { button.disabled=false; button.innerHTML='Track product <span aria-hidden="true">+</span>'; }
});
function updateFilters() { document.querySelectorAll('[data-filter]').forEach(el=>{el.classList.toggle('active',el.dataset.filter===filter);el.setAttribute('aria-pressed',String(el.dataset.filter===filter));}); }
$('#filters').addEventListener('click',event=>{const button=event.target.closest('[data-filter]');if(!button)return;filter=button.dataset.filter;updateFilters();render();});
$('#search').addEventListener('input',event=>{query=event.target.value.toLowerCase().trim();render();});
$('#check-all').addEventListener('click',async()=>{
  $('#check-all').disabled=true;
  try {await api('/api/check','POST');notice('Price checks queued. Results appear here as each store responds.');await refresh(true);}
  catch(err){notice(err.message,true);render();}
});
$('#products').addEventListener('input',event=>{if(event.target.matches('.target-input'))targetDrafts.set(event.target.closest('form').dataset.id,event.target.value);});
$('#products').addEventListener('submit',async event=>{
  if(!event.target.matches('.target-form'))return;
  event.preventDefault(); const form=event.target, id=form.dataset.id; const button=form.querySelector('button');button.disabled=true;
  try {await api(`/api/products/${id}`,'PATCH',{priceThreshold:form.querySelector('input').value});targetDrafts.delete(id);notice('Alert target saved.');await refresh(true);}
  catch(err){notice(err.message,true);} finally {button.disabled=false;}
});
$('#products').addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button)return;
  const {action,id}=button.dataset;
  if(action==='expand'){expanded=expanded===id?null:id;removing=null;render();return;}
  if(action==='remove'){removing=id;render();return;}
  if(action==='cancel-remove'){removing=null;render();return;}
  if(action==='add-focus'){$('#product-url').focus();return;}
  if(action==='clear'){filter='all';query='';$('#search').value='';updateFilters();render();return;}
  if(action==='retry'){await refresh(true);return;}
  button.disabled=true;
  try{
    if(action==='check'){await api(`/api/products/${id}/check`,'POST');notice('Price check queued.');}
    if(action==='confirm-remove'){await api(`/api/products/${id}`,'DELETE');expanded=null;removing=null;targetDrafts.delete(id);notice('Product removed from your watchlist.');}
    await refresh(true);
  }catch(err){notice(err.message,true);}finally{button.disabled=false;}
});
refresh();
setInterval(()=>{if(!document.hidden)refresh();},2500);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
