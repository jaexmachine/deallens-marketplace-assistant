(function initContentScanner() {
  "use strict";

  const ITEM_PATH = "/marketplace/item/";
  const seen = new Set();
  let liveEnabled = true;
  let debounceTimer = null;

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function listingContainer(anchor) {
    let node = anchor;
    for (let depth = 0; depth < 7 && node?.parentElement; depth += 1) {
      const text = cleanText(node.innerText);
      if (text.length >= 20 && text.length <= 1600 && node.querySelectorAll(`a[href*="${ITEM_PATH}"]`).length <= 3) return node;
      node = node.parentElement;
    }
    return anchor.parentElement;
  }

  function extractPrice(text) {
    const currencyMatch = text.match(/(?:₱|PHP\s*)\s*[\d,.]+(?:\s*[kKmM])?/);
    if (currencyMatch) return { label: currencyMatch[0], value: DealLens.parsePrice(currencyMatch[0]) };
    const numberMatch = text.match(/^\s*[\d,.]+(?:\s*[kKmM])?\b/m);
    return numberMatch ? { label: numberMatch[0], value: DealLens.parsePrice(numberMatch[0]) } : { label: "", value: null };
  }

  function extractListing(anchor) {
    const container = listingContainer(anchor);
    if (!container) return null;
    const text = cleanText(container.innerText);
    const url = new URL(anchor.href, location.origin);
    url.search = "";
    const idMatch = url.pathname.match(/\/marketplace\/item\/(\d+)/);
    const price = extractPrice(text);
    const image = container.querySelector("img");
    const lines = String(container.innerText || "").split(/\n+/).map(cleanText).filter(Boolean);
    const title = lines.find(line => line !== price.label && !/^₱/.test(line) && line.length > 2) || image?.alt || "Marketplace listing";
    return {
      id: idMatch?.[1] || url.pathname,
      url: url.href,
      title: cleanText(title).slice(0, 180),
      text: text.slice(0, 1800),
      price: price.value,
      priceLabel: cleanText(price.label),
      image: image?.src || "",
      location: lines.slice(-2).join(" · ").slice(0, 140),
      capturedAt: new Date().toISOString(),
      specs: DealLens.extractSpecs(text),
      category: DealLens.classifyCategory(text)
    };
  }

  function applyBadge(container, listing, scoreData) {
    if (!container) return;
    let badge = container.querySelector(`.deallens-badge[data-id="${CSS.escape(String(listing.id))}"]`);
    if (!badge) badge = document.createElement("span");
    badge.className = `deallens-badge deallens-score-${scoreData.score >= 75 ? "high" : scoreData.score >= 55 ? "mid" : "low"}`;
    badge.dataset.id = listing.id;
    badge.textContent = scoreData.placeholder.value ? "Price?" : `${scoreData.score}`;
    badge.title = scoreData.reasons.join(" • ");
    if (!badge.isConnected) {
      container.style.position ||= "relative";
      container.appendChild(badge);
    }
  }

  async function scanPage(force = false) {
    const anchors = [...document.querySelectorAll(`a[href*="${ITEM_PATH}"]`)];
    const extracted = [];
    anchors.forEach(anchor => {
      const listing = extractListing(anchor);
      if (!listing || (!force && seen.has(listing.id))) return;
      seen.add(listing.id);
      extracted.push(listing);
      const quickScore = DealLens.scoreListing(listing, [], {});
      applyBadge(listingContainer(anchor), listing, quickScore);
    });
    if (extracted.length) {
      await chrome.runtime.sendMessage({ type: "DEALLENS_RESULTS", listings: extracted }).catch(() => {});
    }
    return { found: extracted.length, totalAnchors: anchors.length };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "DEALLENS_SCAN") {
      scanPage(true).then(sendResponse);
      return true;
    }
    if (message?.type === "DEALLENS_LIVE") {
      liveEnabled = Boolean(message.enabled);
      sendResponse({ enabled: liveEnabled });
    }
    if (message?.type === "DEALLENS_SCORES") {
      document.querySelectorAll(`a[href*="${ITEM_PATH}"]`).forEach(anchor => {
        const listing = extractListing(anchor);
        if (listing && message.scores?.[listing.id]) applyBadge(listingContainer(anchor), listing, message.scores[listing.id]);
      });
      sendResponse({ updated: true });
    }
    return false;
  });

  const observer = new MutationObserver(() => {
    if (!liveEnabled) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => scanPage(false), 900);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.local.get(["dealLensSettings"]).then(stored => {
    liveEnabled = stored.dealLensSettings?.liveAnalysis !== false;
    setTimeout(() => scanPage(false), 1200);
  });
})();
