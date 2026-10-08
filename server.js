const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Tracker } = require('./lib/tracker');
const { readJson } = require('./lib/storage');
const { emailConfigured, sendAlertEmail } = require('./lib/alerts');

function createServer(tracker) {
  const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/fonts/manrope.ttf': ['fonts/manrope.ttf', 'font/ttf'], '/fonts/OFL.txt': ['fonts/OFL.txt', 'text/plain'] };
  return http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const expected = `127.0.0.1:${serverPort(res)}`;
      const hosts = [expected, `localhost:${serverPort(res)}`];
      if (!hosts.includes(req.headers.host)) return json(403, { error: 'Use the local dashboard address.' });
      if (req.headers.origin && !hosts.some(host => req.headers.origin === `http://${host}`)) return json(403, { error: 'Cross-site requests are not allowed.' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Cross-site requests are not allowed.' });
      const url = new URL(req.url, `http://${expected}`);
      if (req.method === 'GET' && assets[url.pathname]) {
        const [file, type] = assets[url.pathname];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(fs.readFileSync(path.join(__dirname, 'public', file)));
      }
      if (req.method === 'GET' && url.pathname === '/api/products') return json(200, tracker.list());
      let body = {};
      if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
        if (req.headers['content-type'] !== 'application/json') return json(415, { error: 'Send application/json.' });
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 8192) { json(413, { error: 'Request is too large.' }); return; }
        }
        try { body = JSON.parse(raw || '{}'); } catch { return json(400, { error: 'Invalid JSON.' }); }
        if (!body || Array.isArray(body) || typeof body !== 'object') return json(400, { error: 'Send a JSON object.' });
      }
      const background = promise => promise.catch(err => console.error('Check failed:', err.message));
      if (req.method === 'POST' && url.pathname === '/api/products') {
        const product = tracker.add(body);
        background(tracker.check(product.id));
        return json(201, product);
      }
      if (req.method === 'POST' && url.pathname === '/api/check') {
        background(tracker.checkAll());
        return json(202, { message: 'Checks queued.' });
      }
      const match = url.pathname.match(/^\/api\/products\/([\w-]+)(\/check)?$/);
      if (match) {
        const id = match[1];
        if (req.method === 'POST' && match[2]) { background(tracker.check(id)); return json(202, { message: 'Check queued.' }); }
        if (req.method === 'PATCH' && !match[2]) return json(200, tracker.update(id, body));
        if (req.method === 'DELETE' && !match[2]) { tracker.remove(id); return json(200, { message: 'Removed from watchlist.' }); }
      }
      json(404, { error: 'Not found.' });
    } catch (err) { json(err.status || 400, { error: err.message }); }
  });
}
function serverPort(res) { return res.socket.localPort; }

if (require.main === module) {
  const directory = process.env.TRACKER_DATA_DIR || __dirname;
  const config = readJson(path.join(directory, 'config.json'), { products: [] });
  config.resendApiKey = process.env.RESEND_API_KEY || config.resendApiKey;
  const { scrapeProduct, closeBrowser } = require('./lib/scraper');
  const { Resend } = require('resend');
  const resend = emailConfigured(config) ? new Resend(config.resendApiKey) : null;
  const tracker = new Tracker({ directory, config, scrape: scrapeProduct, send: (product, price) => sendAlertEmail(resend, config, product, price) });
  const server = createServer(tracker);
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '127.0.0.1', () => console.log(`Price Tracker is running at http://localhost:${server.address().port}`));
  server.on('error', err => { console.error(err.message); process.exitCode = 1; });
  // One scheduler and one serialized queue avoid overlapping profile/state writes.
  const timer = setInterval(() => tracker.checkDue().catch(err => console.error(err.message)), 60000);
  timer.unref();
  async function stop() { clearInterval(timer); server.close(); await closeBrowser(); process.exit(0); }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
module.exports = { createServer };
