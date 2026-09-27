# Deal Breaker – Facebook Marketplace Deal Finder

Deal Breaker is a Chrome extension that analyzes Facebook Marketplace electronics listings visible or loaded in your browser. It estimates realistic flip margins from locally scanned comparable asking prices, highlights misleading prices and defects, and prepares seller questions. It uses your existing Facebook session and never sends messages or buys items automatically.

Version 0.7 adds price-bait detection, fatal hardware/ownership flags, Taglish repair-downplaying detection, repair-cost ranges, projected net margin and ROI, separate Deal/Match/Risk/Freshness ratings, laptop CPU checks, iPhone battery sanity checks, and digicam package notes. An optional BYOK photo audit marks every visual result as possible until the user confirms it.

## Feature coverage

- **Deal score:** a transparent 1.0–10.0 rating for every scanned listing.
- **Market guidance:** robust comparable asking-price range, reference value, maximum flip-buy price, projected net margin, and ROI.
- **Risk and condition:** placeholder/price-bait alerts, scam language, ownership locks, disclosed failures, Taglish repair wording, and condition notes.
- **Negotiation:** one click copies a contextual offer and opens the listing for manual use in Messenger. Deal Breaker never sends it automatically.
- **Batch analysis:** visible search/category results are analyzed together and accumulated while scrolling.
- **Personalization:** Watch and Remove feedback changes Match Score only, never financial Deal Score.
- **Existing session and dark mode:** no separate Facebook login; automatic, light, and dark themes.

## Install

1. Extract `Deal-Breaker-0.7.zip` to a permanent folder.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted folder containing `manifest.json`.
6. Pin Deal Breaker to the toolbar.

## Use

Open Facebook Marketplace, open Deal Breaker, and click **Scan loaded results**. Scroll to load more listings. Open a listing card for financial spread, category checks, repair-cost evidence, inspection questions, AI audits, and a negotiation draft. **Find similar** opens an exact-model Marketplace search; scan those results to improve the local market range.

A score prefixed with `~` is provisional. At least three strong, outlier-filtered comparable listings—or a manual reference—are required before Deal Breaker claims a market range or projected profit. Match Score, Risk, and Freshness remain separate from Deal Score.

## AI modes

The optional **local text audit** uses Chrome's built-in Prompt API when supported. Listing text stays on the device, and the rules-only scorer remains fully functional without it.

The optional **BYOK photo audit** uploads only images the user explicitly chooses to Google Gemini. The API key is stored only in `chrome.storage.session` and is forgotten when Chrome ends. Images and keys are not added to listing history. All image findings are labelled possible and do not affect costs or scores until the user checks and saves a confirmation.

## Scoring and safety

Deal Breaker uses the higher description price when possible price bait is detected. Net margin is `reference value − (effective asking price + repair reserve + transport/prep)`. ROI divides that net margin by the total investment. Text-inferred repairs show a Philippine cost range and a suggested reserve that can be replaced with a manual estimate. Old listings lower Freshness only; age does not automatically make a deal bad. Linux/Ubuntu is a verification note rather than an automatic rejection.

Scores are decision support, not guarantees. Inspect in person, verify ownership and serial information, test important functions, and avoid advance payment when you cannot verify the seller or item.

Deal Breaker is not affiliated with, endorsed by, or sponsored by Facebook or Meta.

## Development

Requires Node.js 20+ and `zip`.

```bash
npm test
npm run check
npm run package
```

Facebook can change its page structure. If scanning stops finding cards, update the extraction heuristics in `src/content.js`.
