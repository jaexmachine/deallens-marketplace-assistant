# DealLens MVP

DealLens is a free, local-only Chrome extension that analyzes Facebook Marketplace electronics listings currently visible or loaded in your browser. It estimates deal potential using comparable asking prices, highlights suspicious or placeholder pricing, and prepares questions for sellers. It does not log in for you, run unattended scraping, send messages, or use paid AI services.

## Install

1. Extract `DealLens-MVP.zip` to a permanent folder.
2. In Chrome, open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted folder containing `manifest.json`.
6. Pin DealLens to the toolbar.

## Use

1. Open a Facebook Marketplace search results page.
2. Click the DealLens toolbar icon to open its side panel.
3. Click **Scan loaded results**.
4. Scroll to load more Marketplace results. Live analysis is enabled by default.
5. Open a listing's **Details** to see its reasoning, price range, risk signals, and seller-message draft.
6. Use **Find similar** to open a Marketplace search based on the detected model and specifications; scan those results to improve the local price range.

The toolbar badge shows how many promising listings were detected in the latest batch. The Details view also lets you override the reference value, enter item-specific repair and transport costs, follow an electronics inspection checklist, and record eventual purchase/resale outcomes.

The price-trend database is created from listings you scan. Facebook listings generally show asking prices rather than confirmed sale prices, so DealLens labels them accordingly. More relevant scans produce better comparisons.

## Scoring model

DealLens combines comparable-price discount, listing condition language, risk indicators, comparable sample size, maximum budget, and estimated costs. Placeholder prices are marked as unverified and cannot receive a high-confidence deal score. Every score includes human-readable reasons.

Scores and risk flags are decision support—not guarantees. Inspect products in person, verify model and serial information, test important functions, and avoid advance payment when you cannot verify the seller or item.

## Development

Requirements: Node.js 20 or newer and `zip` for packaging.

```bash
npm test
npm run check
npm run package
```

Facebook can change its page structure at any time. If scanning stops finding cards, the extraction heuristics in `src/content.js` may need adjustment.
