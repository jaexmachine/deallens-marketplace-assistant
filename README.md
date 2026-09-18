# DealLens MVP

DealLens is a free, local-only Chrome extension that analyzes Facebook Marketplace electronics listings currently visible or loaded in your browser. It estimates deal potential using comparable asking prices, highlights suspicious or placeholder pricing, and prepares questions for sellers. It does not log in for you, run unattended scraping, send messages, or use paid AI services.

Version 0.4.4 stabilizes results on Facebook's virtualized pages. Live scans accumulate products for the same search, ignore temporary empty snapshots, and preserve the search list while opening an individual item. Background writes are serialized and panel refreshes are debounced. If an unpacked-extension reload invalidates an older content script, it now shuts down quietly and asks for one page refresh instead of producing an uncaught error. Version 0.4.3 fixed Chrome local-storage quota failures and bounded sanitized history.

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

The scan-status line reports how many visible cards were found, how many were new, and when the scan completed. **Promising on this page** applies the minimum score to both valued and provisional candidates. **Verified-value deals** shows only listings with usable comparable or manually supplied values. Use **All local history** to review products from earlier searches.

Deal Scores now combine market value, condition, safety, listing completeness, and personal fit. A score prefixed with `~` is provisional because DealLens does not yet have a usable reference value. Provisional listings cannot be labeled Good Deals. Scan similar items or enter a manual reference value to unlock a valued score and profit estimate. The Details view shows every component and confidence level.

Use **Watch** as positive feedback and **Remove** as negative feedback. Removed listings stay dismissed on later scans. Settings lets you allow dismissed listings again or reset the learned preference model.

## Optional local AI text audit

Open a listing's Details and select **Run local text audit**. On supported computers, Chrome's built-in Prompt API analyzes the listing text with an on-device model. DealLens checks availability first and reports model-download progress. The audit extracts evidence-backed defect signals, possible contradictions, specifications, advisory liquidity, and verification questions.

The AI audit is optional and never changes repair costs, comparable values, liquidity haircuts, or Deal Scores automatically. It does not send text to an external AI service and uses no API key. The original rule engine remains fully functional when built-in AI is unavailable. Chrome may require a substantial one-time model download and supported hardware. Filipino/Taglish interpretation should be treated cautiously because it is not an officially declared Prompt API language.

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
