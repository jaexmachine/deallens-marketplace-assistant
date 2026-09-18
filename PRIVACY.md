# DealLens privacy notes

DealLens operates locally in Chrome. It stores sanitized listing summaries, settings, and watchlist identifiers in `chrome.storage.local` on the user's device. Local listing history is bounded, derived score/comparable objects are not persisted, and embedded image data is discarded to stay within Chrome's storage quota.

It does not:

- collect Facebook passwords, cookies, or authentication tokens;
- transmit listing or seller information to a developer-controlled server;
- call a paid or cloud AI API;
- automatically send messages or purchase products;
- analyze protected personal characteristics.

The extension requests access only to Facebook Marketplace pages so it can identify visible listing cards. Users can clear stored listing history from the Settings tab or remove all extension data by uninstalling the extension.

On supported Chrome installations, users may manually run the optional built-in AI text auditor. The model runs on the device. DealLens supplies only the listing title, displayed price, description, category, and rule-detected specifications; it excludes seller identity and image URLs. Normalized audit results are stored in `chrome.storage.local`. AI output remains advisory and is not automatically applied to financial calculations.
