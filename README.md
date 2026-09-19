# DealLens MVP

DealLens is a free, local-only Chrome extension that analyzes Facebook Marketplace electronics listings currently visible or loaded in your browser. It estimates deal potential using comparable asking prices, highlights suspicious or placeholder pricing, and prepares questions for sellers. It does not log in for you, run unattended scraping, send messages, or use paid AI services.

Version 0.6 is a correctness and reliability release. It requires at least three strong comparable listings before showing a market range or calculated profit, removes price outliers, fixes negated condition phrases such as “no issue” and “not working,” separates financial Deal Score from personal Match Score, makes preference feedback reversible, routes data changes through one background queue, keeps scan status per tab, and migrates saved data to a versioned schema automatically.

## Feature coverage

- **Deal score on every listing:** always-on rules-based score, enhanced by the optional on-device AI text audit on supported Chrome devices.
- **Market price guidance:** robust comparable asking-price range, clearly sourced reference value, suggested offer, and conservative maximum flip-buy price.
- **Scam and condition analysis:** explicit risk score, red-flag explanations, condition score, and condition notes.
- **Negotiation:** one click copies the contextual offer and opens the Facebook listing so it can be pasted into Messenger. DealLens never sends without the user.
- **Batch analysis:** visible search/category results are analyzed together and accumulated while scrolling.
- **Existing session:** DealLens runs inside the already signed-in Marketplace tab and never requests Facebook credentials.
- **Dark mode:** follow the operating-system theme or select Light/Dark in Settings.

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

Deal Scores combine market value, condition, safety, and listing completeness. Personal preferences are reported separately as a Match Score, so liking a product cannot make an overpriced listing look like a better financial deal. A Deal Score prefixed with `~` is provisional because DealLens does not yet have enough price evidence. Provisional listings cannot be labeled Good Deals. At least three strong, outlier-filtered comparable listings—or a clearly labeled manual reference—are required to unlock a valued score and profit estimate. The Details view shows every component, evidence quality, and confidence level.

Use **Watch** as positive feedback and **Remove** as negative feedback. Feedback is stored once per listing and reverses when an item is unwatched or dismissed listings are restored. Removed listings stay dismissed on later scans. Settings lets you allow dismissed listings again or reset the learned preference model.

## Optional local AI text audit

Select **AI-audit current batch**, or open a listing's Details and select **Run local text audit**. On supported computers, Chrome's built-in Prompt API analyzes listing text with an on-device model. DealLens checks availability first and reports model-download progress. The audit extracts evidence-backed defect signals, possible contradictions, specifications, advisory liquidity, and verification questions.

The AI audit is optional. It can adjust the 10-point Deal Score within a transparent −1.8 to +0.5 bound, but never changes repair costs, comparable values, or placeholder-price safeguards. It does not send text to an external AI service and uses no API key. The original score remains fully functional when built-in AI is unavailable. Chrome may require a substantial one-time model download and supported hardware. Filipino/Taglish interpretation should be treated cautiously because it is not an officially declared Prompt API language.

The toolbar badge shows how many promising listings were detected in the latest batch. The Details view also lets you override the reference value, enter item-specific repair and transport costs, follow an electronics inspection checklist, and record eventual purchase/resale outcomes.

The price-trend database is created from listings you scan. Facebook listings generally show asking prices rather than confirmed sale prices, so DealLens labels them accordingly. More relevant scans produce better comparisons.

## Scoring model

DealLens combines a robust comparable-price discount, condition language, risk indicators, sample quality, and estimated costs. Budget and learned interests affect only the separate Match Score. Comparable asking prices are filtered by category, specifications, textual similarity, and price outliers. Placeholder prices are marked as unverified and cannot receive a high-confidence Deal Score. Every score includes human-readable reasons.

Scores and risk flags are decision support—not guarantees. Inspect products in person, verify model and serial information, test important functions, and avoid advance payment when you cannot verify the seller or item.

## Development

Requirements: Node.js 20 or newer and `zip` for packaging.

```bash
npm test
npm run check
npm run package
```

Facebook can change its page structure at any time. If scanning stops finding cards, the extraction heuristics in `src/content.js` may need adjustment.
