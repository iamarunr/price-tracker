const fs = require('fs');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
  await page.goto('https://www.microcenter.com/product/711043/apple-macbook-pro-16-z1mv0002n-(early-2026)-162-laptop-computer-silver?storeid=095', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 3000));
  const html = await page.content();
  await page.close();
  await browser.close();

  fs.writeFileSync('/tmp/microcenter-page.html', html);
  console.log('HTML saved, length:', html.length);

  const $ = cheerio.load(html);

  // Check JSON-LD
  const jsonLdScripts = $('script[type="application/ld+json"]');
  console.log('\nJSON-LD scripts found:', jsonLdScripts.length);
  for (let i = 0; i < jsonLdScripts.length; i++) {
    try {
      const data = JSON.parse(jsonLdScripts.eq(i).text());
      console.log('JSON-LD[' + i + ']:', JSON.stringify(data).substring(0, 1000));
      // Look for offer/price inside
      if (data.offers) {
        console.log('  -> offers:', JSON.stringify(data.offers));
      }
      if (data.price) {
        console.log('  -> price:', data.price);
      }
    } catch(e) {
      console.log('JSON-LD[' + i + ']: parse error:', e.message);
    }
  }

  // Look for all price-like elements
  console.log('\n--- Price-like elements (standalone price text) ---');
  $('span, div, p').each(function() {
    const text = $(this).text().trim();
    if (/^\$?\s*[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?$/.test(text)) {
      const tag = this.tagName;
      const classes = this.attribs && this.attribs.class ? this.attribs.class : '';
      const id = this.attribs && this.attribs.id ? this.attribs.id : '';
      console.log('  <' + tag + '> text="' + text + '" class="' + classes + '" id="' + id + '"');
    }
  });

  // Look for elements with "price" in class
  console.log('\n--- Elements with "price" in class ---');
  $('[class*="price"]').each(function() {
    const text = $(this).text().trim();
    const classes = this.attribs && this.attribs.class ? this.attribs.class : '';
    if (text) console.log('  class="' + classes + '" text="' + text.substring(0, 120) + '"');
  });

  // Look for sale/discount/was elements
  console.log('\n--- Sale/discount/was elements ---');
  $('[class*="sale"], [class*="discount"], [class*="was"], [class*="original"]').each(function() {
    const text = $(this).text().trim();
    const classes = this.attribs && this.attribs.class ? this.attribs.class : '';
    if (text) console.log('  class="' + classes + '" text="' + text.substring(0, 120) + '"');
  });

  // Look for data-testid elements
  console.log('\n--- data-testid elements ---');
  $('[data-testid]').each(function() {
    const text = $(this).text().trim();
    const tid = this.attribs && this.attribs['data-testid'] ? this.attribs['data-testid'] : '';
    if (text) console.log('  data-testid="' + tid + '" text="' + text.substring(0, 120) + '"');
  });

  // Print a section of the page that might contain the price
  console.log('\n--- Page title ---');
  console.log($('title').text());

  // Look for the product name and nearby price
  console.log('\n--- h1, h2, h3 elements ---');
  $('h1, h2, h3').each(function() {
    const text = $(this).text().trim();
    const classes = this.attribs && this.attribs.class ? this.attribs.class : '';
    if (text) console.log('  <' + this.tagName + '> text="' + text + '" class="' + classes + '"');
  });

  // Look for any element containing "$" and a number
  console.log('\n--- Elements containing $ and digits ---');
  $('*').each(function() {
    if (this.children && this.children.length > 0) return; // skip elements with children
    const text = $(this).text().trim();
    if (/\$[0-9]/.test(text) && text.length < 30) {
      const tag = this.tagName;
      const classes = this.attribs && this.attribs.class ? this.attribs.class : '';
      const parent = this.parentElement ? $(this.parentElement).attr('class') : '';
      console.log('  <' + tag + '> text="' + text + '" class="' + classes + '" parent="' + parent + '"');
    }
  });

})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
