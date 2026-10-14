# Demo data (fictitious)

`frames.json` contains **fictitious data only**. It was produced by a synthetic test application, an imaginary bookstore made of `bookstore-api`, `bookstore-web`, `bookstore-worker` and `inventory-svc`. Trace and span ids are zero-padded counters (`000…001`), every host uses documentation domains (`*.example`, `example.com`) and the dates and times were moved to an arbitrary window (2025-03-11 21:30 to 2025-03-12 00:30, UTC). Service names, routes, tables and SQL belong to the imaginary bookstore and do not mirror any real system, company or user.

The file is read **only** by `scripts/render-demo.mjs`, which renders each panel outside Grafana to produce the screenshots in `docs/images/`. The dashboards in `dashboards/` never read it.

```
node scripts/render-demo.mjs            # writes demo/out/*.html
node scripts/render-demo.mjs --shots    # also writes docs/images/*.png (needs playwright-core and Chrome or Edge)
```
