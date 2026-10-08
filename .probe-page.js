// Throwaway probe: compare VISIBLE price text vs hidden data-price attributes
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const URL = 'https://www.microcenter.com/product/711043/apple-macbook-pro-16-z1mv0002n-(early-2026)-162-laptop-computer-silver?storeid=095';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    channel: 'chrome',
    userDataDir: path.join(__dirname, '.chrome-profile'),
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', '--window-size=1280,800',
      '--no-first-run', '--disable-gpu'
    ]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let title = '';
  for (let i = 0; i < 15; i++) {
    title = await page.title().catch(() => '');
    if (title && !title.includes('Just a moment') && !title.includes('Attention Required')) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  await new Promise(r => setTimeout(r, 3000));
  fs.writeFileSync('/tmp/mc-live.html', await page.content());

  const info = await page.evaluate(() => {
    const out = { title: document.title };
    const main = document.querySelector('[data-id="711043"]');
    out.mainElOuter = main ? main.outerHTML.slice(0, 4000) : null;
    out.mainElInnerText = main ? main.innerText.slice(0, 2500) : null;
    out.dataPriceEls = [...document.querySelectorAll('[data-price]')].slice(0, 30).map(el => ({
      id: el.getAttribute('data-id'),
      price: el.getAttribute('data-price'),
      visible: el.offsetParent !== null,
      text: (el.textContent || '').trim().slice(0, 120)
    }));
    out.jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map(s => s.textContent.slice(0, 1500));
    const bodyText = document.body.innerText;
    out.visibleDollarAmounts = bodyText.match(/\$[\d,]+(?:\.\d+)?/g) || [];
    out.availabilityWords = bodyText.match(/[Ss]old [Oo]ut|[Oo]ut of [Ss]tock|[Uu]navailable|[Cc]all for [Pp]rice|[Ss]pecial [Bb]uy|[Cc]heck [Ss]tore [Aa]vail|Regional [Pp]ricing|Order Online|In Store/g) || [];
    const cartBtn = [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean);
    out.buttonTexts = cartBtn.slice(0, 25);
    return out;
  });

  fs.writeFileSync('/tmp/mc-visible.txt', await page.evaluate(() => document.body.innerText));
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
