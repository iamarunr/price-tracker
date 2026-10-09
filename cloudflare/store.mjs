import model from '../lib/model.js';
const { makeProduct, summarize, productKey, validateTarget } = model;
export const STALE_JOB_MS = 15 * 60 * 1000;
function fromRow(row, history) {
  return { id: row.id, url: row.url, name: row.name, priceThreshold: row.price_threshold, createdAt: row.created_at,
    lastAttemptAt: row.last_attempt_at, lastError: row.last_error, alertError: row.alert_error,
    lastAlert: row.last_alert ? JSON.parse(row.last_alert) : null, history,
    checking: Boolean(row.pending_job), pendingJob: row.pending_job };
}
export class Store {
  constructor(db, now = () => Date.now()) { this.db = db; this.now = now; }
  sql(query, ...args) { return this.db.prepare(query).bind(...args); }
  async row(id) { return this.sql('SELECT * FROM products WHERE id = ?', id).first(); }
  async get(id) {
    const row = await this.row(id);
    if (!row) throw Object.assign(new Error('Product not found.'), { status: 404 });
    const { results } = await this.sql('SELECT price,currency,checked_at AS at,source FROM observations WHERE product_id = ? ORDER BY id', id).all();
    return fromRow(row, results);
  }
  async list() {
    const { results: rows } = await this.sql('SELECT * FROM products ORDER BY created_at DESC').all();
    const { results: observations } = await this.sql('SELECT product_id,price,currency,checked_at AS at,source FROM observations ORDER BY id').all();
    const histories = new Map();
    for (const { product_id, ...observation } of observations) {
      if (!histories.has(product_id)) histories.set(product_id, []);
      histories.get(product_id).push(observation);
    }
    return rows.map(row => {
      const { pendingJob, ...p } = fromRow(row, histories.get(row.id) || []);
      return summarize(p, p.checking);
    });
  }
  async add(input) {
    const product = makeProduct(input);
    try {
      const inserted = await this.sql(`INSERT INTO products(id,product_key,url,name,price_threshold,created_at)
        SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM products) < 50`, product.id, productKey(product.url), product.url, product.name, product.priceThreshold, product.createdAt).run();
      if (!inserted.meta.changes) throw Object.assign(new Error('You can track up to 50 products in the hosted dashboard.'), { status: 400 });
    } catch (err) {
      if (/UNIQUE constraint/.test(err.message)) throw Object.assign(new Error('This product is already on your watchlist.'), { status: 409 });
      throw err;
    }
    return summarize(product);
  }
  async update(id, input) {
    await this.get(id);
    await this.sql('UPDATE products SET price_threshold = ? WHERE id = ?', validateTarget(input.priceThreshold), id).run();
    const p = await this.get(id); return summarize(p, p.checking);
  }
  async remove(id) {
    const result = await this.sql('DELETE FROM products WHERE id = ?', id).run();
    if (!result.meta.changes) throw Object.assign(new Error('Product not found.'), { status: 404 });
  }
  async reserve(id) {
    if (!await this.row(id)) throw Object.assign(new Error('Product not found.'), { status: 404 });
    const jobId = crypto.randomUUID(), now = this.now();
    const result = await this.sql(`UPDATE products SET pending_job=?,queued_at=?,processing_token=NULL,lease_until=0
      WHERE id=? AND (pending_job IS NULL OR queued_at < ?) AND
      (last_attempt_at IS NULL OR last_attempt_at <= ? OR queued_at < ?)`, jobId, now, id, now - STALE_JOB_MS,
      new Date(now - 60000).toISOString(), now - STALE_JOB_MS).run();
    return result.meta.changes ? { id, jobId } : null;
  }
  async enqueue(id, queue) {
    const job = await this.reserve(id);
    if (!job) return;
    try { await queue.send(job); }
    catch (err) {
      await this.sql("UPDATE products SET pending_job=NULL,queued_at=NULL,last_error='Could not queue the check. Try again.' WHERE id=? AND pending_job=?", id, job.jobId).run();
      throw err;
    }
  }
  async due() {
    const now = this.now();
    return (await this.sql(`SELECT id FROM products WHERE
      (pending_job IS NULL AND (last_attempt_at IS NULL OR last_attempt_at <= ?)) OR
      (pending_job IS NOT NULL AND queued_at < ?)`, new Date(now-3600000).toISOString(), now-STALE_JOB_MS).all()).results;
  }
  async claim(job) {
    const token = crypto.randomUUID(), now = this.now();
    const result = await this.sql(`UPDATE products SET processing_token=?,lease_until=?,last_attempt_at=?
      WHERE id=? AND pending_job=? AND lease_until < ?`, token, now+180000, new Date(now).toISOString(), job.id, job.jobId, now).run();
    return result.meta.changes ? token : null;
  }
  async owns(job, token) { return Boolean(await this.sql('SELECT id FROM products WHERE id=? AND pending_job=? AND processing_token=?', job.id, job.jobId, token).first()); }
  async previousResult(job) { return this.sql('SELECT price,currency,source,checked_at AS at FROM observations WHERE job_id=?', job.jobId).first(); }
  async record(job, token, result) {
    const current = await this.get(job.id);
    if (current.history.at(-1)?.currency && current.history.at(-1).currency !== result.currency) throw new Error('The store currency changed. Remove and re-add the product to start a new history.');
    await this.db.batch([
      this.sql(`INSERT OR IGNORE INTO observations(job_id,product_id,price,currency,checked_at,source)
        SELECT ?,id,?,?,?,? FROM products WHERE id=? AND pending_job=? AND processing_token=?`,
        job.jobId,result.price,result.currency,new Date(this.now()).toISOString(),result.source,job.id,job.jobId,token),
      this.sql('UPDATE products SET name=?,last_error=NULL WHERE id=? AND pending_job=? AND processing_token=?',result.name || current.name,job.id,job.jobId,token),
      this.sql('DELETE FROM observations WHERE product_id=? AND id NOT IN (SELECT id FROM observations WHERE product_id=? ORDER BY id DESC LIMIT 2000)',job.id,job.id)
    ]);
  }
  async complete(job, token, { error=null, alertError=null, alert=null }={}) {
    await this.sql(`UPDATE products SET pending_job=NULL,queued_at=NULL,lease_until=0,processing_token=NULL,
      last_error=?,alert_error=?,last_alert=COALESCE(?,last_alert) WHERE id=? AND pending_job=? AND processing_token=?`,
      error,alertError,alert ? JSON.stringify(alert) : null,job.id,job.jobId,token).run();
  }
  async release(job, token) { await this.sql('UPDATE products SET lease_until=0,processing_token=NULL WHERE id=? AND pending_job=? AND processing_token=?',job.id,job.jobId,token).run(); }
}
