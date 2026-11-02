# SocialWorks Ad Tracker

Client Meta ad tracker in the SocialWorks Pro portal design. Three tabs:

- **Dashboard** (`/`): 8 totals (spend, leads, cost per lead, appointments, lead to appointment %, cost per appointment, closed deals, revenue), date filter, business search, and every ad account with a Meta-style drill-down: account > campaign > ad set > ad.
- **Calendar** (`/calendar`): month view of every client's appointments, with a day agenda.
- **Clients** (`/clients`): rename the business name, see the Meta ad account name (read-only), set status to Active, Paused or Churned.

No login. The root URL opens the dashboard.

## What is live

With `META_ACCESS_TOKEN` set, the header shows a green **Live from Meta** pill and:

- **Spend, leads and cost per lead** come from Meta for every ad account the token can see, at every level (account, campaign, ad set, ad) and in the totals, for the picked date range.
- Campaign, ad set and ad **status dots** are Meta's own (green = active), and each ad shows its **creative thumbnail**. Click the thumbnail to see Meta's real **ad preview**.
- The **Clients** tab lists those ad accounts.
- Appointments, lead to appointment, cost per appointment, closed deals and revenue show "–" until GoHighLevel is connected. The calendar's appointments are still sample data (with the real client names).

Leads are Meta's `lead` action, the **Leads** column in Ads Manager (instant forms, Messenger and website leads together). Compare against Leads, not Results. Cost per lead is spend / leads. If Meta rejects the token, the dashboard shows that message instead of numbers.

Without a token the whole app runs on **dummy data** (orange **Dummy data** pill), generated from a fixed seed in `src/lib/data.ts`. Business-name and status edits are saved in the viewer's browser (`localStorage`) by ad account id until there is a backend.

## Environment (Vercel)

| Variable | |
| --- | --- |
| `META_ACCESS_TOKEN` | System user token with `ads_read`. Assign every client ad account to that system user in Business Settings. |
| `META_APP_SECRET` | Signs every call with `appsecret_proof`. Then turn on "Require App Secret" in the Meta app settings. |
| `META_API_VERSION` | Optional, default `v26.0`. |

All server-only; never prefix them with `NEXT_PUBLIC_`. The token never reaches the browser: pages call `/api/meta/overview`, `/api/meta/account/[id]` and `/api/meta/preview/[adId]`, which call Meta from `src/lib/meta.ts`. Answers are cached in memory (ad accounts 1 hour, numbers 10 minutes, statuses and thumbnails 1 hour).

## Run

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
```

### Testing without Meta

`src/lib/__fixtures__/` holds recorded-shape Graph API answers. Locally:

```bash
META_FIXTURE=1 npm run dev        # the app as if Meta answered (7 accounts, one without access)
META_FIXTURE=error npm run dev    # Meta rejects the token
node src/lib/__fixtures__/check.mjs   # proves the rollup and leads math, and the live request path
```

`META_FIXTURE` only works with those two values and never in a production build or on Vercel.

## Design source

`src/components/v2/swa.css`, `src/app/globals.css`, `src/components/v2/iconsData.ts`, `icons.tsx`, `Toast.tsx` and `Tooltip.tsx` are verbatim copies from `socialworks-portal-frontend`. Re-copy them to pick up design changes. The only app-authored CSS is `src/app/tracker.css`.

## Plugging in the rest

| What | Replace | Source |
| --- | --- | --- |
| Appointments, closed deals, revenue | `dailyMetrics()` and `appointmentsBetween()` in `src/lib/data.ts` | GoHighLevel |
| Business name, status | `src/lib/store.tsx` (currently `localStorage`) | your backend |

## Shareable single-page build

`node artifact/build.mjs` (after `npm run build`) bundles the same pages into one self-contained `artifact/dist/ad-tracker.html`, using hash routes (`#calendar`, `#clients`) instead of Next routes. It has no API routes, so it always shows the dummy data.
