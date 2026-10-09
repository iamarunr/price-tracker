const { randomUUID } = require('node:crypto');
const { validateProductUrl } = require('./extract');

const INTERVAL = 60 * 60 * 1000;
function productKey(url) {
  const parsed = new URL(url);
  return parsed.hostname === 'www.microcenter.com' ? `${parsed.hostname}/${parsed.pathname.match(/\/product\/(\d+)/)[1]}?${parsed.searchParams}` : url;
}
function validateTarget(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 100000000) throw new Error('Enter a target price greater than zero.');
  return Math.round(number * 100) / 100;
}
function makeProduct(input) {
  const url = validateProductUrl(input.url);
  return { id: randomUUID(), url, name: String(input.name || new URL(url).hostname.replace(/^www\./, '')).slice(0, 300),
    priceThreshold: validateTarget(input.priceThreshold), createdAt: new Date().toISOString(), history: [],
    lastAttemptAt: null, lastError: null, alertError: null, lastAlert: null };
}
function summarize(product, checking = false) {
  const last = product.history.at(-1);
  const previous = product.history.at(-2);
  const delta = last && previous ? Math.round((last.price - previous.price) * 100) / 100 : null;
  return { ...product, checking, currentPrice: last?.price ?? null, previousPrice: previous?.price ?? null,
    currency: last?.currency || null, delta,
    status: delta === null ? (last ? 'baseline' : 'pending') : delta < 0 ? 'dropped' : delta > 0 ? 'increased' : 'unchanged',
    checkedAt: last?.at || null, lowestPrice: last ? Math.min(...product.history.map(h => h.price)) : null,
    nextCheckAt: new Date((product.lastAttemptAt ? Date.parse(product.lastAttemptAt) : Date.now()) + INTERVAL).toISOString() };
}

module.exports = { INTERVAL, productKey, validateTarget, makeProduct, summarize };
