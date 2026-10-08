const path = require('node:path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { validateProductUrl, extractProduct, unavailableReason } = require('./extract');
const { assertPublicUrl } = require('./network');
puppeteer.use(StealthPlugin());

// Persistent profile can retain store preferences; bot challenges may still block checks.
let browser = null;
const isHeaded = process.argv.includes('--headed') || process.env.HEADLESS === 'false';
const profileDir = path.join(__dirname, '..', '.chrome-profile');

async function getBrowser() {
  if (browser && !browser.connected) browser = null;
  if (!browser) {
    const launchArgs = [
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
      '--no-first-run',
      '--disable-gpu'
    ];
    console.log(isHeaded
      ? 'Launching Chrome headed with persistent profile (solve Cloudflare once if prompted)...'
      : 'Launching Chrome headless with persistent profile...');
    try {
      // Prefer real installed Chrome — far less detectable than bundled Chromium
      browser = await puppeteer.launch({
        headless: isHeaded ? false : true,
        channel: 'chrome',
        userDataDir: profileDir,
        args: launchArgs
      });
    } catch (err) {
      console.warn(`Could not launch real Chrome (${err.message}), falling back to bundled Chromium.`);
      browser = await puppeteer.launch({
        headless: isHeaded ? false : true,
        userDataDir: profileDir,
        args: launchArgs
      });
    }
  }
  return browser;
}

async function fetchPage(url, retries = 2) {
  url = validateProductUrl(url);
  await assertPublicUrl(url);
  console.log(`Fetching: ${url}`);
  const brow = await getBrowser();

  let lastErr = null;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const page = await brow.newPage();

    try {
      await page.setBypassServiceWorker(true);
      await page.setRequestInterception(true);
      page.on('request', request => {
        if (['image', 'media', 'font'].includes(request.resourceType())) return void request.abort().catch(() => {});
        assertPublicUrl(request.url()).then(() => request.continue()).catch(() => request.abort()).catch(() => {});
      });
      await page.setViewport({ width: 1280, height: 800 });
      // Realistic user agent + headers
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9'
      });

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      if (response && response.status() >= 400) throw new Error(`Store returned HTTP ${response.status()}. Try again later.`);
      await assertPublicUrl(page.url());

      // Wait for Cloudflare challenge to clear (up to ~30s).
      // Cloudflare shows title "Just a moment..." while challenging.
      let cleared = false;
      for (let i = 0; i < 15; i++) {
        const title = await page.title().catch(() => '');
        if (title && !title.includes('Just a moment') && !title.includes('Attention Required')) {
          cleared = true;
          break;
        }
        await new Promise(r => setTimeout(r, 2000));
      }

      if (!cleared) {
        const title = await page.title().catch(() => '');
        console.warn(`  ⚠️  Still on Cloudflare challenge page (title: "${title}") after 30s (attempt ${attempt}).`);
        if (!isHeaded && attempt > retries) {
          console.warn('  Tip: run once headed to clear it: node price-tracker.js --check-price --headed');
        }
        if (attempt <= retries) {
          await page.close().catch(() => {});
          console.log(`  Retrying... (${attempt}/${retries})`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
      }

      if (!cleared) throw new Error('The store requires browser verification. Try opening its product page and check again later.');

      // Give dynamic content a moment to render, then capture
      await new Promise(r => setTimeout(r, 2000));

      const html = await page.content();
      await page.close().catch(() => {});

      return html;
    } catch (err) {
      lastErr = err;
      await page.close().catch(() => {});
      if (attempt <= retries) {
        console.warn(`  ⚠️  Fetch attempt ${attempt} failed (${err.message}), retrying...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function closeBrowser() {
  if (browser) {
    const previous = browser;
    browser = null;
    await previous.close().catch(() => {});
  }
}


async function scrapeProduct(url) {
  const html = await fetchPage(url);
  const unavailable = unavailableReason(html, url);
  if (unavailable) throw new Error(unavailable);
  const result = extractProduct(html, url);
  if (!result) throw new Error('Could not verify the price for this product. The store may have changed its page or blocked the check. Your last price is preserved.');
  return result;
}
module.exports = { fetchPage, scrapeProduct, closeBrowser };
