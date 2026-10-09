const path = require('node:path');
const { atomicWrite, readJson } = require('./storage');
const { maybeAlert, emailConfigured } = require('./alerts');

const { INTERVAL, productKey, validateTarget, makeProduct, summarize } = require('./model');

class Tracker {
  constructor({ directory, config = {}, scrape, send, now = () => new Date() }) {
    this.file = path.join(directory, 'tracker-state.json');
    this.config = config;
    this.scrape = scrape;
    this.send = send;
    this.now = now;
    this.queue = Promise.resolve();
    this.pending = new Map();
    this.state = readJson(this.file, null);
    if (!this.state) {
      this.state = { version: 1, products: (config.products || []).map(makeProduct) };
      this.save();
    }
    if (this.state.version !== 1 || !Array.isArray(this.state.products) || this.state.products.some(p => !Array.isArray(p.history))) throw new Error('Unsupported tracker-state.json. Restore a valid backup.');
  }
  save() { atomicWrite(this.file, this.state); }
  list() { return { products: this.state.products.map(p => summarize(p, this.pending.has(p.id))), emailEnabled: emailConfigured(this.config), intervalMinutes: INTERVAL / 60000 }; }
  find(id) {
    const product = this.state.products.find(p => p.id === id);
    if (!product) throw Object.assign(new Error('Product not found.'), { status: 404 });
    return product;
  }
  add(input) {
    if (this.state.products.length >= 100) throw new Error('You can track up to 100 products.');
    const product = makeProduct(input);
    if (this.state.products.some(p => productKey(p.url) === productKey(product.url))) throw Object.assign(new Error('This product is already on your watchlist.'), { status: 409 });
    this.state.products.push(product);
    this.save();
    return summarize(product);
  }
  update(id, input) {
    const product = this.find(id);
    product.priceThreshold = validateTarget(input.priceThreshold);
    this.save();
    return summarize(product, this.pending.has(id));
  }
  remove(id) {
    this.find(id);
    this.state.products = this.state.products.filter(p => p.id !== id);
    this.save();
  }
  check(id) {
    this.find(id);
    if (this.pending.has(id)) return this.pending.get(id);
    const task = this.queue.then(async () => {
      const product = this.state.products.find(p => p.id === id);
      if (!product) return;
      product.lastAttemptAt = this.now().toISOString();
      try {
        const result = await this.scrape(product.url);
        if (!result || !Number.isFinite(result.price) || result.price <= 0 || !/^[A-Z]{3}$/.test(result.currency)) throw new Error('The store did not return a valid price and currency.');
        if (!this.state.products.includes(product)) return;
        const last = product.history.at(-1);
        if (last && last.currency !== result.currency) throw new Error('The store currency changed. Remove and re-add the product to start a new price history.');
        product.history.push({ price: result.price, currency: result.currency, at: this.now().toISOString(), source: result.source });
        product.history = product.history.slice(-2000);
        if (result.name) product.name = result.name;
        product.lastError = null;
        product.alertError = null;
        // Save the verified observation independently of email delivery.
        this.save();
        try {
          const alert = await maybeAlert({ product, price: result.price, config: this.config, previous: product.lastAlert, send: this.send });
          if (alert) product.lastAlert = alert;
        } catch (err) { product.alertError = err.message; }
      } catch (err) { product.lastError = err.message; }
      if (this.state.products.includes(product)) this.save();
    }).finally(() => this.pending.delete(id));
    this.pending.set(id, task);
    this.queue = task.catch(() => {});
    return task;
  }
  checkAll() { return Promise.all(this.state.products.map(p => this.check(p.id))); }
  checkDue() {
    return Promise.all(this.state.products.filter(p => !p.lastAttemptAt || this.now() - new Date(p.lastAttemptAt) >= INTERVAL).map(p => this.check(p.id)));
  }
}
module.exports = { Tracker, summarize, validateTarget, INTERVAL };
