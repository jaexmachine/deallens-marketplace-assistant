importScripts("scoring.js");

const DEFAULT_SETTINGS = {
  maxPrice: 30000,
  minimumScore: 55,
  defaultCosts: 500,
  keywords: "laptop, phone, console, camera",
  liveAnalysis: true
};

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const stored = await chrome.storage.local.get(["dealLensSettings"]);
  if (!stored.dealLensSettings) await chrome.storage.local.set({ dealLensSettings: DEFAULT_SETTINGS });
});

async function mergeListings(incoming) {
  const stored = await chrome.storage.local.get(["dealLensListings", "dealLensSettings"]);
  const listings = stored.dealLensListings || {};
  const settings = { ...DEFAULT_SETTINGS, ...(stored.dealLensSettings || {}) };
  incoming.forEach(item => {
    const existing = listings[item.id] || {};
    listings[item.id] = { ...existing, ...item, firstSeenAt: existing.firstSeenAt || item.capturedAt, lastSeenAt: item.capturedAt };
  });
  const rows = Object.values(listings);
  rows.forEach(item => {
    item.analysis = DealLens.scoreListing(item, rows, settings);
  });
  await chrome.storage.local.set({ dealLensListings: listings });
  return { listings: rows, settings };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "DEALLENS_RESULTS") {
    mergeListings(message.listings || []).then(({ listings, settings }) => {
      if (sender.tab?.id) {
        const scores = Object.fromEntries(listings.map(item => [item.id, item.analysis]));
        chrome.tabs.sendMessage(sender.tab.id, { type: "DEALLENS_SCORES", scores }).catch(() => {});
      }
      chrome.runtime.sendMessage({ type: "DEALLENS_UPDATED", count: listings.length }).catch(() => {});
      const incomingIds = new Set((message.listings || []).map(item => item.id));
      const promising = listings.filter(item => incomingIds.has(item.id) && item.analysis.score >= settings.minimumScore && !item.analysis.placeholder.value).length;
      chrome.action.setBadgeBackgroundColor({ color: promising ? "#087c5c" : "#68756f" });
      chrome.action.setBadgeText({ text: promising ? String(Math.min(promising, 99)) : "" });
      sendResponse({ saved: message.listings?.length || 0 });
    });
    return true;
  }
  if (message?.type === "DEALLENS_RECALCULATE") {
    mergeListings([]).then(({ listings }) => sendResponse({ count: listings.length }));
    return true;
  }
  return false;
});
