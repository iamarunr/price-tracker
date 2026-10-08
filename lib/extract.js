const cheerio = require('cheerio');

function validateProductUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a valid product link, starting with https://.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)) {
    throw new Error('Use an HTTPS product link on a public store website.');
  }
  url.hash = '';
  if (['microcenter.com', 'www.microcenter.com'].includes(url.hostname)) {
    url.hostname = 'www.microcenter.com';
    if (!/^\/product\/\d+(?:\/|$)/.test(url.pathname)) throw new Error('Use a Micro Center product page, not a search or category page.');
    const store = url.searchParams.get('storeid');
    url.search = '';
    if (store) {
      if (!/^\d{1,4}$/.test(store)) throw new Error('The store ID in this link is invalid.');
      url.searchParams.set('storeid', store);
    }
  } else {
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(gclid|fbclid)$/.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

function money(value) {
  const text = String(value ?? '').trim().replace(/^\$\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2}0*)?$/.test(text)) return null;
  const number = Number(text.replaceAll(',', ''));
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : null;
}

function unavailableReason(html, productUrl) {
  const url = new URL(productUrl);
  if (!['www.microcenter.com', 'microcenter.com'].includes(url.hostname)) return null;
  const id = url.pathname.match(/\/product\/(\d+)/)?.[1];
  const $ = cheerio.load(html);
  const main = $(`h1 [data-id="${id}"]`).closest('.StandardSku');
  if (main.hasClass('ACnlc') || /no longer carried/i.test(main.text())) {
    return 'Micro Center marks this product as “No longer carried.” Its hidden catalog price is not a current offer. Try a current listing or another store.';
  }
  return null;
}

function extractProduct(html, productUrl) {
  const url = new URL(validateProductUrl(productUrl));
  const id = url.hostname === 'www.microcenter.com' ? url.pathname.match(/\/product\/(\d+)/)[1] : null;
  const $ = cheerio.load(html);
  if (unavailableReason(html, productUrl)) return null;
  if (/just a moment|attention required|access denied/i.test($('title').text())) return null;
  const name = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || '';
  const result = (price, source, productName = name, currency = 'USD') => ({ price, currency, name: String(productName).trim().slice(0, 300), source });
  const uniquePrice = values => {
    const prices = [...new Set(values.map(money).filter(p => p !== null))];
    return prices.length === 1 ? prices[0] : null;
  };
  // Never fall back to arbitrary page prices: related products and financing
  // amounts are not evidence of this product's price.
  const elements = id ? $(`[data-id="${id}"][data-price]`) : $([]);
  if (elements.length) {
    const price = uniquePrice(elements.map((_, el) => $(el).attr('data-price')).get());
    if (price === null) return null; // Conflicting variants need human verification.
    return result(price, `Product ${id} data-price`);
  }
  const nodes = [];
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    const types = [].concat(value['@type'] || []);
    if (types.includes('Product')) nodes.push(value);
    if (value['@graph']) walk(value['@graph']);
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    try { walk(JSON.parse($(el).text())); } catch { /* Ignore malformed metadata. */ }
  });
  const canonical = $('link[rel="canonical"]').attr('href');
  const samePage = value => {
    if (!value) return false;
    try {
      const other = new URL(value, url);
      return other.origin === url.origin && other.pathname.replace(/\/$/, '') === url.pathname.replace(/\/$/, '') && other.search === url.search;
    } catch { return false; }
  };
  for (const product of nodes) {
    const identities = [product.url, product['@id'], product.mainEntityOfPage?.['@id']];
    const matched = identities.some(value => {
      if (!value) return false;
      try { return id ? new URL(value, url).pathname.match(/\/product\/(\d+)/)?.[1] === id : samePage(value); } catch { return false; }
    }) || (!id && nodes.length === 1 && identities.every(v => !v) && samePage(canonical));
    if (!matched) continue;
    const offers = [].concat(product.offers || []);
    // Conflicting currencies, sellers, or variants must not become a guessed price.
    const validOffers = offers.filter(o => /^[A-Z]{3}$/.test(o.priceCurrency || '') && o.price !== undefined);
    if (new Set(validOffers.map(o => o.priceCurrency)).size !== 1) continue;
    if (id && validOffers[0]?.priceCurrency !== 'USD') continue;
    const price = uniquePrice(validOffers.map(o => o.price));
    if (price !== null) return result(price, 'Product structured data', product.name || name, validOffers[0].priceCurrency);
  }
  return null;
}

module.exports = { validateProductUrl, extractProduct, money, unavailableReason };
