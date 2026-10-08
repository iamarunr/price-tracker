#!/usr/bin/env node
const path = require('node:path');
const { readJson, atomicWrite } = require('./lib/storage');
const { scrapeProduct, closeBrowser } = require('./lib/scraper');
const { maybeAlert, emailConfigured, sendAlertEmail } = require('./lib/alerts');
const { Resend } = require('resend');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const checkOnly = process.argv.includes('--check-price');
  const config = readJson(path.join(__dirname, 'config.json'), { products: [] });
  config.resendApiKey = process.env.RESEND_API_KEY || config.resendApiKey;
  // Legacy alert-state.json may contain false prices from the old parser or dry runs.
  // Leave it intact for inspection; new alerts use a separate verified state file.
  const statePath = path.join(__dirname, 'verified-alert-state.json');
  const state = readJson(statePath, {});
  const resend = emailConfigured(config) ? new Resend(config.resendApiKey) : null;
  if (!resend && !checkOnly) console.log('Email is not configured. Prices will still be checked.');
  try {
    for (const product of config.products || []) {
      try {
        const result = await scrapeProduct(product.url);
        console.log(`${result.name || product.name}: ${result.currency} ${result.price.toFixed(2)} (${result.source})`);
        if (checkOnly) continue;
        const alert = await maybeAlert({ product, price: result.price, config, previous: state[product.url], dryRun,
          send: (p, price) => sendAlertEmail(resend, config, { ...p, currency: result.currency }, price) });
        if (alert?.dryRun) console.log('Dry run: an alert would be sent. No state was changed.');
        else if (alert) { state[product.url] = alert; atomicWrite(statePath, state); console.log('Email accepted by the delivery service.'); }
      } catch (err) { console.error(`${product.name}: ${err.message}`); process.exitCode = 1; }
    }
  } finally { await closeBrowser(); }
}
if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await closeBrowser(); process.exit(0); });
}
module.exports = { main };
