# Pulse

Personal market-watch page: a single `index.html`, served with GitHub Pages from `main`.

## Working agreement

- **Merge automatically.** When a change is finished and tested, open a pull request and merge it into `main` without asking first, then say that it is live. (Standing instruction from the owner, 14 Nov 2026.)
- Still stop and ask before merging if a test or check fails, or if the change could lose the owner's saved data (watchlist and holdings live in the browser's local storage).

## How it fits together

- `index.html` — the whole app. It reads price data from the `data` branch through raw.githubusercontent.com.
- `.github/workflows/prices.yml` — scheduled job (about every 15 minutes) that publishes `prices.json` and `etfs.json` to the `data` branch. Scheduled runs only happen from `main`; a push that touches the job's files also runs it on that branch.
- `tickers.txt` — tickers the price job covers. A ticker added in the app but missing here falls back to an unreliable public relay.
- `etfs.txt` — funds ranked in the Analysis tab and used by the children's planner tabs, with their category.
- `scripts/quote.mjs` — `yahooSym` and `parseYahoo` are duplicated in `index.html`; change both together.
- `scripts/fetch-etfs.mjs` — bump the version in `sig` when the return calculation changes, so the job refetches.

## Privacy

- The repository and the page are public. The children's planner tabs keep names and birthday months in the browser only (set up in the app or through a `#kids=Name:YYYY-MM` link). Never put the owner's or their children's names, dates or holdings in code, commits or pull requests.

## Testing

- Yahoo Finance refuses requests from cloud sessions, so test the fetch scripts by pushing the branch and reading the workflow run's log and the file it publishes.
- Fund price history from the source has unit glitches; after changing `fetch-etfs.mjs`, check that funds tracking the same index still agree.
- Test the page in headless Chromium with the published `prices.json` / `etfs.json` served as stubbed responses.
