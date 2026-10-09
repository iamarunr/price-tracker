# Deploy the private Cloudflare tracker

This version runs the dashboard and API together in a **Worker**, stores history in **D1**, and checks prices with **Browser Run** through **Queues**. A scheduled trigger looks for hourly-due products every five minutes. Your computer can be off. The existing Pages deployment is separate; use the new Worker URL after setup.

## 1. Sign in

From this repository, with dependencies installed:

```sh
npm run cf:login
npm run cf:whoami
```

Complete the browser authorization with the Cloudflare account that owns your project.

## 2. Create storage and the queue

```sh
npm run cf:db:create
```

Copy the returned database ID into `wrangler.jsonc`, replacing the all-zero `database_id`. Keep the binding `DB` and migrations directory as supplied. Then:

```sh
npm run cf:queue:create
npm run cf:db:migrate
npm run cf:deploy
```

If a resource already exists, use its existing ID/name instead of creating another. This deploy creates a Worker named `price-tracker`; review an existing Worker with that name before replacing it. The initial URL deliberately returns “Cloudflare Access is not configured.” until the next step.

Browser use is metered. Check your account's [Browser Run limits](https://developers.cloudflare.com/browser-run/limits/) and [pricing](https://developers.cloudflare.com/browser-run/pricing/) before enabling tracking. Free-plan launch limits can cause failed checks when several products are added together; the app retains the last verified price.

## 3. Make the dashboard private

In **Workers & Pages → price-tracker (Worker) → Settings → Domains & Routes**, enable Cloudflare Access for the `workers.dev` address. Select **Manage Cloudflare Access** and configure an Allow policy for your email address. Cloudflare documents this [Access setup](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/).

Copy the application's audience (AUD) and team domain from the Access setup. Configure these three secrets, entering each value at its prompt:

```sh
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
npx wrangler secret put ALLOWED_EMAILS
```

- `ACCESS_TEAM_DOMAIN`: your hostname, such as `my-team.cloudflareaccess.com`, **without** `https://` or a trailing slash.
- `ACCESS_AUD`: the audience for this specific Access application.
- `ALLOWED_EMAILS`: your exact login email. Multiple comma-separated emails share the same watchlist; this is not a multi-tenant service.

Secrets persist across normal deployments. The Worker validates the signed Access token as well as the allowed email, including on static assets. Preview URLs are disabled. If you later add a custom domain, protect it with Access and use the matching application's audience.

## 4. Verify a real product

Open the Worker URL printed by deployment, sign in, and paste an active product URL. It should move from checking to a verified baseline, or show an explicit store error. Later successful observations show unchanged, dropped, or increased relative to the previous successful check. Use `npm run cf:logs` to inspect failures.

The cloud watchlist starts empty; local history/configuration/browser cookies are not uploaded. Micro Center discontinued product pages deliberately fail instead of reporting stale hidden prices.

Enabled store domains are listed in `ALLOWED_STORE_HOSTS` in `wrangler.jsonc`. Add only trusted retailer domains and redeploy to expand the list. Requests to third-party domains are blocked, which can prevent some stores from rendering prices. Store inclusion does not guarantee extraction: login requirements, bot challenges, missing data and ambiguous offers produce a failed check. Cloud Browser Run does not reuse your local Chrome profile.

## 5. Optional email alerts

```sh
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put FROM_EMAIL
npx wrangler secret put TO_EMAIL
```

Use a sender authorized in Resend. Set a target on the product card. No email secrets are needed for price tracking. Accepted alerts are recorded; failed delivery requests remain retryable on a later check. Queue retries reuse an email idempotency key.

## Maintenance and validation

```sh
npm ci
npm test
npm run cf:build
node test/cloudflare.runtime.js
node test/dashboard.browser.js
```

The runtime smoke uses the Miniflare version supplied by the locked Wrangler dependency. It tests the actual Workers runtime and D1 with fixture prices, without making remote browser or email calls. A live Browser Run check still needs the configured Cloudflare account.

For subsequent changes, apply any new migrations and deploy:

```sh
npm run cf:db:migrate
npm run cf:deploy
```

Pushing to GitHub alone does not update this Worker unless you separately configure Workers Builds. The original `npm start` local dashboard remains available.

The hosted app supports 50 products, retains 2,000 observations per product, coalesces checks, and applies a one-minute manual-check cooldown. Leases and unique job IDs protect against duplicate queue delivery. Abandoned work becomes eligible again after 15 minutes. A failed check never overwrites a valid observation.

Dependency audit currently reports upstream browser-downloader advisories under Cloudflare's Puppeteer package. Those downloader modules are absent from the generated Worker bundle. Do not use `npm audit fix --force`: its proposed downgrade replaces the supported browser SDK with an older incompatible version. Reassess when upstream releases a fix.
