# Price Tracker

A local dashboard for watching product prices. Paste a product link, save its first verified price, and see whether the next price is **unchanged**, **dropped**, or **increased**.

## Run the dashboard

Requires Node.js 22.12+ (or a newer supported Node release) and Chrome, or Puppeteer's bundled browser.

```sh
npm install
npm start
```

Open **http://localhost:3000**. The app binds to your computer's loopback interface only. Use `PORT=3001 npm start` for another port.

- Paste an HTTPS product URL and select **Track product**. The first check runs immediately.
- Expand a product to see its price history, save an optional email target, check again, or remove it.
- **Check all prices** refreshes the watchlist. Checks run one at a time; duplicate requests are coalesced.
- Automatic checks run about hourly while the Node server is running and the computer is awake. Closing the browser tab does not stop the server; quitting Node or sleeping the computer stops checks. Overdue products are checked on the scheduler's next one-minute tick after startup or wake.
- Search and filters help you find drops, increases, unchanged prices, or failed checks.

### What the status means

The first successful observation establishes a baseline. Later statuses compare the **last two successful checks**, not the purchase price or alert target. A failure never replaces your last valid price. The dashboard displays the failure separately and retains the previous comparison and timestamp.

History is persisted in `tracker-state.json` (the latest 2,000 observations per product). The chart shows up to 60 recent observations, with recorded values available in a table. Tracking resumes from this file when you restart. Back it up if you want to preserve your history.

On first run only, products in the existing `config.json` are imported. The legacy `alert-state.json` is left untouched and is **not** trusted as a verified price history. This avoids importing false prices from old fallback extraction or dry runs.

### Store support

Micro Center has a dedicated product-ID parser and preserves `storeid` in the URL. Other public stores are supported **when their rendered page contains unambiguous Product/Offer structured data tied to that product page** (including JSON-LD arrays and graphs). Currency is saved with every price; comparisons stop if the currency changes.

This does not guarantee support for every retailer. Stores may block browser automation, require sign-in, show location-dependent prices, or omit usable structured data. Conflicting offers, unknown currencies, financing amounts, unrelated product prices and aggregate price ranges are not guessed. A failed extraction is shown as a failed check. The displayed price is an observation, not a guarantee of stock or price-adjustment eligibility.

Do not run the dashboard and the legacy CLI at the same time: they share a persistent Chrome profile. If Micro Center requires a browser challenge, stop the dashboard and try `npm run check-price:headed`, then restart. Manual browser verification may help but is not guaranteed to persist.

### Optional email alerts

Tracking does not require an email account. To enable alerts, edit `config.json` (copy `config.example.json` if needed), configure a Resend API key and sender/recipient, and restart. You can also supply `RESEND_API_KEY` as an environment variable. Never commit credentials or the Chrome profile.

Set a target in a product's expanded details. Alerts are sent when the price is below the target and below the last successfully emailed price. Targets use the product's observed currency. An accepted email is recorded only after Resend returns a delivery ID; failures remain retryable on later checks. Acceptance by Resend does not prove inbox delivery.

## Command-line checks

The original commands remain available for products configured in `config.json`:

```sh
npm run check-price         # Print prices; no emails or alert-state writes
npm run check-price:headed  # Visible browser
npm run dry-run             # Preview alerts; no emails or alert-state writes
npm run track               # Check prices and optionally email
```

CLI alerts use `verified-alert-state.json`; dashboard alerts use per-product state in `tracker-state.json`. Avoid scheduling both for the same products, as their email deduplication records are separate. The CLI is a one-shot command; it does not schedule itself.

## Verification

```sh
npm test                    # Parser, alerts, history, persistence, queue and API tests
node test/dashboard.browser.js  # Chrome UI checks with synthetic prices and temporary data
```

Browser checks create screenshots under `.impeccable/review/`. They never put demonstration prices in your real dashboard. `npm test` now runs actual tests; use `npm run dry-run` for the old scrape-preview behavior.

## Files

- `server.js`: local HTTP server and scheduler
- `lib/`: scraping, product validation, extraction, history, atomic storage and email
- `public/`: dependency-free dashboard UI
- `price-tracker.js`: one-shot CLI
- `tracker-state.json`: local product history and dashboard alert state
- `config.json`: initial products and optional email settings

This is a single-user local app, not a public hosting deployment. Its server rejects cross-site writes, exposes only explicit public assets, and checks browser requests against private/local network destinations. Do not expose it through a public tunnel or reverse proxy without adding authentication and a deployment-specific network policy.
