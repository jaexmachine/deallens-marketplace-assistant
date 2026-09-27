(function initContentScanner() {
  "use strict";

  const ITEM_PATH = "/marketplace/item/";
  const seen = new Set();
  let liveEnabled = true;
  let debounceTimer = null;
  let observer = null;
  let disposed = false;
  let lastDetailFingerprint = "";

  function stopScanner() {
    disposed = true;
    liveEnabled = false;
    clearTimeout(debounceTimer);
    observer?.disconnect();
    const status = document.querySelector("#deallens-scan-control small");
    if (status) status.textContent = "Extension updated — refresh this tab";
  }

  function runtimeMessage(payload) {
    try {
      if (disposed || !chrome.runtime?.id) throw new Error("Extension context invalidated.");
      return chrome.runtime.sendMessage(payload).catch(error => {
        if (DealLensScan.isContextInvalidated(error)) stopScanner();
        throw error;
      });
    } catch (error) {
      if (DealLensScan.isContextInvalidated(error)) stopScanner();
      return Promise.reject(error);
    }
  }

  function handleAutomaticScanError(error) {
    if (DealLensScan.isContextInvalidated(error)) {
      stopScanner();
      return;
    }
    console.warn("DealLens automatic scan paused", error);
  }

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
      description: "",
      descriptionSource: "card-preview",
      descriptionComplete: false,
      price: price.value,
      priceLabel: cleanText(price.label),
      image: image?.src || "",
      location: lines.slice(-2).join(" · ").slice(0, 140),
      capturedAt: new Date().toISOString(),
      specs: DealLens.extractSpecs(text),
      category: DealLens.classifyCategory(text)
    };
  }

  function detailTitle() {
    const heading = [...document.querySelectorAll('h1, [role="main"] h2')]
      .map(node => cleanText(node.textContent))
      .find(value => value.length > 2 && value.length <= 180 && !/^Marketplace$/i.test(value));
    const meta = cleanText(document.querySelector('meta[property="og:title"]')?.content || "").replace(/\s*\|\s*Facebook.*$/i, "");
    return heading || meta || "Marketplace listing";
  }

  function detailPrice() {
    const main = document.querySelector('div[role="main"], main');
    const candidates = [...(main?.querySelectorAll("span, div") || [])]
      .map(node => cleanText(node.textContent))
      .filter(value => value.length <= 40 && /^(?:₱|PHP\s*)\s*[\d,.]+(?:\s*[kKmM])?$/.test(value));
    return extractPrice(candidates[0] || cleanText(main?.innerText || ""));
  }

  function extractDetailListing() {
    const match = location.pathname.match(/\/marketplace\/item\/(\d+)/);
    if (!match) return null;
    const description = DealBreakerDescription.extract(document);
    const title = detailTitle();
    const price = detailPrice();
    const fallbackText = cleanText(document.querySelector('meta[property="og:description"]')?.content || "");
    const text = description || fallbackText || title;
    const image = document.querySelector('meta[property="og:image"]')?.content || document.querySelector('div[role="main"] img')?.src || "";
    return {
      id: match[1],
      url: `${location.origin}${location.pathname}`,
      title: title.slice(0, 180),
      text: text.slice(0, 6000),
      description: description.slice(0, 6000),
      descriptionSource: description ? "full-detail" : "detail-fallback",
      descriptionComplete: Boolean(description),
      price: price.value,
      priceLabel: cleanText(price.label),
      image,
      location: "",
      capturedAt: new Date().toISOString(),
      specs: DealLens.extractSpecs(`${title} ${text}`),
      category: DealLens.classifyCategory(`${title} ${text}`)
    };
  }

  function applyBadge(container, listing, scoreData) {
    if (!container) return;
    let badge = container.querySelector(`.deallens-badge[data-id="${CSS.escape(String(listing.id))}"]`);
    if (!badge) badge = document.createElement("button");
    const pending = scoreData.pending === true;
    badge.className = pending
      ? "deallens-badge deallens-score-pending"
      : `deallens-badge deallens-score-${scoreData.score >= 7.5 ? "high" : scoreData.score >= 5.5 ? "mid" : "low"}`;
    badge.dataset.id = listing.id;
    badge.type = "button";
    badge.textContent = pending ? "…" : scoreData.placeholder.value ? "Price?" : scoreData.scoreStatus === "provisional" ? `~${Number(scoreData.score).toFixed(1)}` : Number(scoreData.score).toFixed(1);
    badge.title = pending ? "Deal Breaker is calculating this score" : `${scoreData.scoreStatus === "provisional" ? "Provisional score" : "Deal score"} · Click for details · ${scoreData.reasons.join(" • ")}`;
    badge.setAttribute("aria-label", `Open Deal Breaker details for ${listing.title}`);
    if (!badge.dataset.bound) {
      badge.dataset.bound = "true";
      badge.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        runtimeMessage({ type: "DEALLENS_OPEN_DETAILS", listingId: listing.id }).catch(() => {});
      });
    }
    if (!badge.isConnected) {
      container.style.position ||= "relative";
      container.appendChild(badge);
    }
  }

  async function performScan(force = false) {
    if (disposed) throw new Error("DealLens was updated. Refresh this Marketplace tab.");
    const isDetailPage = location.pathname.startsWith(ITEM_PATH);
    if (force && isDetailPage && DealBreakerDescription.expand(document)) {
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    const allAnchors = [...document.querySelectorAll(`a[href*="${ITEM_PATH}"]`)];
    const unique = new Map();
    allAnchors.forEach(anchor => {
      const match = new URL(anchor.href, location.origin).pathname.match(/\/marketplace\/item\/(\d+)/);
      if (match?.[1] && !unique.has(match[1])) unique.set(match[1], anchor);
    });
    const anchors = [...unique.values()];
    const pageListings = anchors.map(extractListing).filter(Boolean);
    const detailListing = isDetailPage ? extractDetailListing() : null;
    if (detailListing) {
      const existingIndex = pageListings.findIndex(item => item.id === detailListing.id);
      if (existingIndex >= 0) pageListings[existingIndex] = { ...pageListings[existingIndex], ...detailListing };
      else pageListings.unshift(detailListing);
    }
    if (!force && !pageListings.length) {
      return { found: 0, analyzed: 0, totalAnchors: anchors.length, ignoredEmpty: true, newCount: 0, saved: 0 };
    }
    const detailFingerprint = detailListing ? `${detailListing.id}:${detailListing.description.length}:${detailListing.price || 0}` : "";
    const extracted = pageListings.filter(listing => force || !seen.has(listing.id) || (listing.id === detailListing?.id && detailFingerprint !== lastDetailFingerprint));
    if (detailFingerprint) lastDetailFingerprint = detailFingerprint;
    extracted.forEach(listing => {
      seen.add(listing.id);
      const anchor = unique.get(String(listing.id));
      if (anchor) applyBadge(listingContainer(anchor), listing, { pending: true });
    });
    const saved = await DealLensScan.withTimeout(
      runtimeMessage({
        type: "DEALLENS_RESULTS",
        listings: extracted,
        visibleIds: pageListings.map(listing => listing.id),
        pageUrl: location.href,
        pageKey: DealLensScan.marketplacePageKey(location.href),
        manual: force,
        preserveCurrent: location.pathname.startsWith(ITEM_PATH)
      }),
      15000,
      "DealLens storage did not respond. Try scanning again."
    );
    if (saved?.error) throw new Error(saved.error);
    return {
      found: pageListings.length,
      analyzed: extracted.length,
      totalAnchors: anchors.length,
      newCount: saved?.newCount || 0,
      saved: saved?.saved || 0,
      storageRecovered: saved?.storageRecovered === true
    };
  }

  const scanPage = DealLensScan.createSingleFlight(performScan);

  function ensureScanControl() {
    if (document.querySelector("#deallens-scan-control") || !document.body) return;
    const control = document.createElement("div");
    control.id = "deallens-scan-control";
    control.innerHTML = '<button type="button"><span>◎</span> Scan with Deal Breaker</button><small>Ready</small>';
    const button = control.querySelector("button");
    const status = control.querySelector("small");
    button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "Scanning loaded products…";
      control.dataset.state = "scanning";
      try {
        const result = await scanPage(true);
        status.textContent = result.storageRecovered ? `${result.found} visible · storage cleaned` : `${result.found} visible · ${result.newCount} new`;
        control.dataset.state = "done";
      } catch {
        status.textContent = "Scan failed — refresh Marketplace";
        control.dataset.state = "error";
      } finally {
        button.disabled = false;
      }
    });
    document.body.appendChild(control);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "DEALLENS_PING") {
      sendResponse({ ready: true });
      return false;
    }
    if (message?.type === "DEALLENS_SCAN") {
      scanPage(true)
        .then(sendResponse)
        .catch(error => sendResponse({ error: error?.message || "Scan failed" }));
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

  observer = new MutationObserver(mutations => {
    if (disposed || !liveEnabled || !DealLensScan.hasMarketplaceMutation(mutations)) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => scanPage(false).catch(handleAutomaticScanError), 900);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  try {
    chrome.storage.local.get(["dealLensSettings"]).then(stored => {
      if (disposed) return;
      liveEnabled = stored.dealLensSettings?.liveAnalysis !== false;
      ensureScanControl();
      setTimeout(() => scanPage(false).catch(handleAutomaticScanError), 1200);
    }).catch(handleAutomaticScanError);
  } catch (error) {
    handleAutomaticScanError(error);
  }
})();
