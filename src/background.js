importScripts("scoring.js", "storage.js");

const DEFAULT_SETTINGS = {
  maxPrice: 30000,
  minimumScore: 55,
  defaultCosts: 500,
  keywords: "laptop, phone, console, camera",
  liveAnalysis: true
};

let storageQueue = Promise.resolve();

function queueStorage(task) {
  const result = storageQueue.then(task, task);
  storageQueue = result.then(() => undefined, () => undefined);
  return result;
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const stored = await chrome.storage.local.get(["dealLensSettings"]);
  if (!stored.dealLensSettings) await chrome.storage.local.set({ dealLensSettings: DEFAULT_SETTINGS });
  await queueStorage(compactStoredListings);
});

async function compactStoredListings() {
  const stored = await chrome.storage.local.get(["dealLensListings", "dealLensWatchlist", "dealLensCurrentScan"]);
  const protectedIds = [...(stored.dealLensWatchlist || []), ...(stored.dealLensCurrentScan?.ids || [])];
  const rows = DealLensStorage.pruneListings(Object.values(stored.dealLensListings || {}), protectedIds);
  if (rows.length || Object.keys(stored.dealLensListings || {}).length) {
    await DealLensStorage.persist(chrome.storage.local, rows);
  }
}

queueStorage(compactStoredListings).catch(error => console.error("DealLens storage cleanup failed", error));

async function mergeListings(incoming, currentScan = null) {
  const stored = await chrome.storage.local.get(["dealLensListings", "dealLensSettings", "dealLensDismissed", "dealLensPreferenceModel", "dealLensWatchlist", "dealLensCurrentScan"]);
  const mergedScan = DealLensStorage.mergeCurrentScan(stored.dealLensCurrentScan, currentScan);
  const protectedIds = [...(stored.dealLensWatchlist || []), ...(mergedScan.value?.ids || [])];
  const listings = DealLensStorage.listingMap(DealLensStorage.pruneListings(Object.values(stored.dealLensListings || {}), protectedIds));
  const settings = { ...DEFAULT_SETTINGS, ...(stored.dealLensSettings || {}) };
  const dismissed = new Set(stored.dealLensDismissed || []);
  const preferenceModel = stored.dealLensPreferenceModel || { weights: {}, feedbackCount: 0 };
  let newCount = 0;
  incoming.map(DealLensStorage.sanitizeListing).filter(item => item && !dismissed.has(item.id)).forEach(item => {
    const existing = listings[item.id] || {};
    if (!listings[item.id]) newCount += 1;
    listings[item.id] = { ...existing, ...item, firstSeenAt: existing.firstSeenAt || item.capturedAt, lastSeenAt: item.capturedAt };
  });
  const rawRows = DealLensStorage.pruneListings(Object.values(listings), protectedIds);
  const rows = rawRows.map(item => ({ ...item, analysis: DealLens.scoreListing(item, rawRows, settings, preferenceModel) }));
  const updates = {};
  if (currentScan) updates.dealLensCurrentScan = mergedScan.value;
  const storageResult = await DealLensStorage.persist(chrome.storage.local, rawRows, updates);
  return { listings: rows, settings, newCount, currentChanged: mergedScan.changed, storageRecovered: storageResult.recovered };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "DEALLENS_RESULTS") {
    const currentScan = message.preserveCurrent ? null : {
      tabId: sender.tab?.id || null,
      url: message.pageUrl || sender.tab?.url || "",
      pageKey: message.pageKey || message.pageUrl || sender.tab?.url || "",
      ids: [...new Set(message.visibleIds || (message.listings || []).map(item => item.id))],
      scannedAt: new Date().toISOString()
    };
    queueStorage(() => mergeListings(message.listings || [], currentScan)).then(({ listings, settings, newCount, currentChanged, storageRecovered }) => {
      if (sender.tab?.id) {
        const scores = Object.fromEntries(listings.map(item => [item.id, item.analysis]));
        chrome.tabs.sendMessage(sender.tab.id, { type: "DEALLENS_SCORES", scores }).catch(() => {});
      }
      if (newCount || currentChanged || storageRecovered) chrome.runtime.sendMessage({ type: "DEALLENS_UPDATED", count: listings.length }).catch(() => {});
      const incomingIds = new Set((message.listings || []).map(item => item.id));
      const promising = listings.filter(item => incomingIds.has(item.id) && item.analysis.scoreStatus === "valued" && item.analysis.score >= settings.minimumScore && !item.analysis.placeholder.value).length;
      chrome.action.setBadgeBackgroundColor({ color: promising ? "#087c5c" : "#68756f" });
      chrome.action.setBadgeText({ text: promising ? String(Math.min(promising, 99)) : "" });
      sendResponse({ saved: message.listings?.length || 0, newCount, total: listings.length, storageRecovered });
    }).catch(error => {
      console.error("DealLens could not save scan results", error);
      sendResponse({ error: DealLensStorage.isQuotaError(error) ? "DealLens storage is full and could not be cleaned automatically. Open Settings and clear local listing data." : `DealLens could not save this scan: ${error?.message || "Unknown storage error"}` });
    });
    return true;
  }
  if (message?.type === "DEALLENS_RECALCULATE") {
    queueStorage(() => mergeListings([])).then(({ listings }) => sendResponse({ count: listings.length })).catch(error => sendResponse({ error: error?.message || "Could not recalculate listings" }));
    return true;
  }
  if (message?.type === "DEALLENS_OPEN_DETAILS" && sender.tab?.id && message.listingId) {
    const storeSelection = chrome.storage.local.set({ dealLensSelectedId: message.listingId });
    const openPanel = chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    Promise.all([storeSelection, openPanel]).then(() => {
      chrome.runtime.sendMessage({ type: "DEALLENS_SHOW_DETAILS", listingId: message.listingId }).catch(() => {});
      sendResponse({ opened: true });
    });
    return true;
  }
  return false;
});
