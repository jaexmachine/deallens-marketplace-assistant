# DealLens privacy notes

DealLens operates locally in Chrome. It stores scanned listing summaries, settings, and watchlist identifiers in `chrome.storage.local` on the user's device.

It does not:

- collect Facebook passwords, cookies, or authentication tokens;
- transmit listing or seller information to a developer-controlled server;
- call an AI API or other paid service;
- automatically send messages or purchase products;
- analyze protected personal characteristics.

The extension requests access only to Facebook Marketplace pages so it can identify visible listing cards. Users can clear stored listing history from the Settings tab or remove all extension data by uninstalling the extension.
