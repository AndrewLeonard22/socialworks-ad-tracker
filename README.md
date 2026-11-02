# SocialWorks Ad Tracker

Client Meta ad tracker in the SocialWorks Pro portal design. Three tabs:

- **Dashboard** (`/`): 8 totals (spend, leads, cost per lead, appointments, lead to appointment %, cost per appointment, closed deals, revenue), date filter, business search, and every ad account with a Meta-style drill-down: account > campaign > ad set.
- **Calendar** (`/calendar`): month view of every client's appointments, with a day agenda.
- **Clients** (`/clients`): rename the business name, see the Meta ad account name (read-only), set status to Active, Paused or Churned.

No login. The root URL opens the dashboard.

**All data is dummy data.** It is generated from a fixed seed in `src/lib/data.ts`, so numbers stay stable between reloads. Business-name and status edits are saved in the viewer's browser (`localStorage`) until there is a backend.

## Run

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
```

## Design source

`src/components/v2/swa.css`, `src/app/globals.css`, `src/components/v2/iconsData.ts`, `icons.tsx`, `Toast.tsx` and `Tooltip.tsx` are verbatim copies from `socialworks-portal-frontend`. Re-copy them to pick up design changes. The only app-authored CSS is `src/app/tracker.css`.

## Plugging in real data

| What | Replace | Source |
| --- | --- | --- |
| Accounts, campaigns, ad sets | `buildAccounts()` in `src/lib/data.ts` | Meta Marketing API |
| Spend, leads per ad set per day | `dailyMetrics()` in `src/lib/data.ts` | Meta insights (`time_increment=1`) |
| Appointments, closed deals, revenue | `dailyMetrics()` and `appointmentsBetween()` | CRM / calendar |
| Business name, status | `src/lib/store.tsx` (currently `localStorage`) | your backend |

Keep the shapes (`Account`, `Totals`, `Appointment`) and the pages keep working.

## Shareable single-page build

`node artifact/build.mjs` (after `npm run build`) bundles the same pages into one self-contained `artifact/dist/ad-tracker.html`, using hash routes (`#calendar`, `#clients`) instead of Next routes.
