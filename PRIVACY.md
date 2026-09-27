# Deal Breaker privacy notes

Deal Breaker stores sanitized listing summaries, settings, per-tab scan state, preference feedback, watchlist identifiers, and confirmed audit findings in `chrome.storage.local`. Listing history is bounded; derived comparable objects, API keys, and image bytes are not persisted.

Deal Breaker does not collect Facebook passwords, cookies, or authentication tokens; automatically send messages; purchase products; or analyze protected personal characteristics. It is not affiliated with Facebook or Meta.

The extension requests access to Facebook Marketplace pages to identify visible listing cards. The optional cloud image-audit host permission is requested only after the user clicks **Audit visuals**. Users can decline it and keep every local feature.

## Local text AI

On supported Chrome installations, the optional built-in AI text audit runs on-device. It receives only listing title, displayed price, description, category, and rule-detected specifications. Normalized results can make a bounded, visible score adjustment.

## Optional BYOK visual AI

When the user explicitly selects photos and starts a visual audit, those selected images and limited listing context are sent directly from the extension to Google Gemini using the user's API key. The key is held only in `chrome.storage.session` and is forgotten when the Chrome session ends. Deal Breaker does not save image bytes. Returned findings are labelled possible and do not change repair costs or scores until the user explicitly confirms them.

Users can forget the session key from the audit panel, clear saved listings in Settings, revoke the optional host permission in Chrome, or remove all extension data by uninstalling the extension.
