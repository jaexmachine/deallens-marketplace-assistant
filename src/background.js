importScripts("scoring.js", "storage.js");

const DEFAULT_SETTINGS = {
  maxPrice: 30000,
  minimumScore: 5.5,
  defaultCosts: 500,
  keywords: "laptop, phone, console, camera",
  liveAnalysis: true,
  theme: "system"
};

let storageQueue = Promise.resolve();

function queueStorage(task) {
  const result = storageQueue.then(task, task);
  storageQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function migrateStorage() {
  const stored = await chrome.storage.local.get(null);
  const migration = DealLensStorage.migrateStoredData(stored);
  const settings = { ...DEFAULT_SETTINGS, ...(stored.dealLensSettings || {}) };
  settings.minimumScore = DealLens.normalizeMinimumScore(settings.minimumScore);
  await chrome.storage.local.set({ ...migration, dealLensSettings: settings });
  await chrome.storage.local.remove(["dealLensCurrentScan", "dealLensLastScan"]);
}

async function compactStoredListings() {
  const stored = await chrome.storage.local.get(["dealLensListings", "dealLensWatchlist", "dealLensCurrentScans"]);
  const tabScanIds = Object.values(stored.dealLensCurrentScans || {}).flatMap(scan => scan?.ids || []);
  const protectedIds = [...(stored.dealLensWatchlist || []), ...tabScanIds];
  const rows = DealLensStorage.pruneListings(Object.values(stored.dealLensListings || {}), protectedIds);
  if (rows.length || Object.keys(stored.dealLensListings || {}).length) await DealLensStorage.persist(chrome.storage.local, rows);
}

queueStorage(async () => {
  await migrateStorage();
  await compactStoredListings();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  queueStorage(async () => {
    await migrateStorage();
    await compactStoredListings();
  }).catch(error => console.error("DealLens installation migration failed", error));
});

async function mergeListings(incoming, currentScan = null) {
  const stored = await chrome.storage.local.get(["dealLensListings", "dealLensSettings", "dealLensDismissed", "dealLensPreferenceModel", "dealLensWatchlist", "dealLensCurrentScans", "dealLensScanStatuses"]);
  const scans = { ...(stored.dealLensCurrentScans || {}) };
  const mergedScans = currentScan ? DealLensStorage.mergeTabScan(scans, currentScan) : { value: scans, changed: false };
  const protectedIds = [...(stored.dealLensWatchlist || []), ...Object.values(mergedScans.value).flatMap(scan => scan?.ids || [])];
  const listings = DealLensStorage.listingMap(DealLensStorage.pruneListings(Object.values(stored.dealLensListings || {}), protectedIds));
  const settings = { ...DEFAULT_SETTINGS, ...(stored.dealLensSettings || {}) };
  settings.minimumScore = DealLens.normalizeMinimumScore(settings.minimumScore);
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
  if (currentScan) {
    updates.dealLensCurrentScans = mergedScans.value;
    updates.dealLensScanStatuses = DealLensStorage.mergeTabStatus(stored.dealLensScanStatuses, {
      tabId: currentScan.tabId,
      pageKey: currentScan.pageKey,
      found: currentScan.visibleCount,
      newCount,
      scannedAt: currentScan.scannedAt
    });
  }
  const shouldPersist = incoming.length > 0 || mergedScans.changed || currentScan?.manual;
  const storageResult = shouldPersist
    ? await DealLensStorage.persist(chrome.storage.local, rawRows, updates)
    : { recovered: false };
  return { listings: rows, settings, newCount, currentChanged: mergedScans.changed, storageRecovered: storageResult.recovered };
}

async function updateListings(patches) {
  const stored = await chrome.storage.local.get(["dealLensListings", "dealLensWatchlist", "dealLensCurrentScans"]);
  const listings = { ...(stored.dealLensListings || {}) };
  (patches || []).forEach(({ listingId, patch }) => {
    if (!listingId || !listings[listingId] || !patch || typeof patch !== "object") return;
    listings[listingId] = DealLensStorage.sanitizeListing({ ...listings[listingId], ...patch, id: listingId });
  });
  const protectedIds = [...(stored.dealLensWatchlist || []), ...Object.values(stored.dealLensCurrentScans || {}).flatMap(scan => scan?.ids || [])];
  await DealLensStorage.persist(chrome.storage.local, DealLensStorage.pruneListings(Object.values(listings), protectedIds));
  return mergeListings([]);
}

async function setFeedback(listingId, direction, fallbackListing = null) {
  const stored = await chrome.storage.local.get(["dealLensListings", "dealLensFeedback", "dealLensPreferenceModel"]);
  const item = stored.dealLensListings?.[listingId] || fallbackListing;
  const previous = stored.dealLensFeedback?.[listingId];
  const signals = item ? DealLens.preferenceSignals(item) : previous?.signals || [];
  const result = DealLensStorage.applyPreferenceFeedback(stored.dealLensFeedback, stored.dealLensPreferenceModel, listingId, signals, direction);
  await chrome.storage.local.set({ dealLensFeedback: result.feedback, dealLensPreferenceModel: result.preferenceModel });
  return result;
}

async function setWatch(listingId, watched) {
  const stored = await chrome.storage.local.get(["dealLensWatchlist"]);
  const watchlist = new Set(stored.dealLensWatchlist || []);
  watched ? watchlist.add(listingId) : watchlist.delete(listingId);
  await chrome.storage.local.set({ dealLensWatchlist: [...watchlist] });
  await setFeedback(listingId, watched ? 1 : 0);
  return mergeListings([]);
}

async function dismissListing(listingId, fallbackListing) {
  const stored = await chrome.storage.local.get(["dealLensListings", "dealLensDismissed", "dealLensWatchlist", "dealLensCurrentScans"]);
  const listings = { ...(stored.dealLensListings || {}) };
  delete listings[listingId];
  const dismissed = new Set(stored.dealLensDismissed || []);
  dismissed.add(listingId);
  const watchlist = new Set(stored.dealLensWatchlist || []);
  watchlist.delete(listingId);
  const scans = { ...(stored.dealLensCurrentScans || {}) };
  Object.values(scans).forEach(scan => { scan.ids = (scan.ids || []).filter(id => id !== listingId); });
  await setFeedback(listingId, -1, fallbackListing);
  await DealLensStorage.persist(chrome.storage.local, Object.values(listings), {
    dealLensDismissed: [...dismissed],
    dealLensWatchlist: [...watchlist],
    dealLensCurrentScans: scans
  });
  return mergeListings([]);
}

async function restoreDismissed() {
  const stored = await chrome.storage.local.get(["dealLensFeedback", "dealLensPreferenceModel"]);
  let feedback = stored.dealLensFeedback || {};
  let model = stored.dealLensPreferenceModel || { weights: {}, feedbackCount: 0 };
  Object.entries({ ...feedback }).forEach(([id, entry]) => {
    if (Number(entry.direction) >= 0) return;
    const result = DealLensStorage.applyPreferenceFeedback(feedback, model, id, entry.signals, 0);
    feedback = result.feedback;
    model = result.preferenceModel;
  });
  await chrome.storage.local.set({ dealLensDismissed: [], dealLensFeedback: feedback, dealLensPreferenceModel: model });
}

chrome.tabs.onRemoved.addListener(tabId => {
  queueStorage(async () => {
    const stored = await chrome.storage.local.get(["dealLensCurrentScans", "dealLensScanStatuses"]);
    const scans = { ...(stored.dealLensCurrentScans || {}) };
    const statuses = { ...(stored.dealLensScanStatuses || {}) };
    delete scans[String(tabId)];
    delete statuses[String(tabId)];
    await chrome.storage.local.set({ dealLensCurrentScans: scans, dealLensScanStatuses: statuses });
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = task => {
    queueStorage(async () => {
      return task();
    }).then(sendResponse).catch(error => {
      console.error("DealLens operation failed", error);
      sendResponse({ error: DealLensStorage.isQuotaError(error) ? "DealLens storage is full and could not be cleaned automatically." : error?.message || "DealLens operation failed" });
    });
    return true;
  };

  if (message?.type === "DEALLENS_RESULTS") {
    const currentScan = message.preserveCurrent ? null : {
      tabId: sender.tab?.id || null,
      url: message.pageUrl || sender.tab?.url || "",
      pageKey: message.pageKey || message.pageUrl || sender.tab?.url || "",
      ids: [...new Set(message.visibleIds || (message.listings || []).map(item => item.id))],
      visibleCount: (message.visibleIds || []).length,
      manual: Boolean(message.manual),
      scannedAt: new Date().toISOString()
    };
    return respond(async () => {
      const result = await mergeListings(message.listings || [], currentScan);
      if (sender.tab?.id) {
        const scores = Object.fromEntries(result.listings.map(item => [item.id, item.analysis]));
        chrome.tabs.sendMessage(sender.tab.id, { type: "DEALLENS_SCORES", scores }).catch(() => {});
      }
      if (result.newCount || result.currentChanged || result.storageRecovered) chrome.runtime.sendMessage({ type: "DEALLENS_UPDATED", count: result.listings.length }).catch(() => {});
      const incomingIds = new Set(message.visibleIds || (message.listings || []).map(item => item.id));
      const promising = result.listings.filter(item => incomingIds.has(item.id) && item.analysis.scoreStatus === "valued" && item.analysis.score >= result.settings.minimumScore && !item.analysis.placeholder.value).length;
      chrome.action.setBadgeBackgroundColor({ color: promising ? "#087c5c" : "#68756f" });
      chrome.action.setBadgeText({ text: promising ? String(Math.min(promising, 99)) : "" });
      return { saved: message.listings?.length || 0, newCount: result.newCount, total: result.listings.length, storageRecovered: result.storageRecovered };
    });
  }
  if (message?.type === "DEALLENS_RECALCULATE") return respond(async () => ({ count: (await mergeListings([])).listings.length }));
  if (message?.type === "DEALLENS_UPDATE_LISTINGS") return respond(async () => ({ count: (await updateListings(message.patches || [])).listings.length }));
  if (message?.type === "DEALLENS_SET_WATCH") return respond(async () => ({ count: (await setWatch(message.listingId, Boolean(message.watched))).listings.length }));
  if (message?.type === "DEALLENS_DISMISS") return respond(async () => ({ count: (await dismissListing(message.listingId, message.listing)).listings.length }));
  if (message?.type === "DEALLENS_SAVE_SETTINGS") return respond(async () => {
    const stored = await chrome.storage.local.get(["dealLensSettings"]);
    const settings = { ...DEFAULT_SETTINGS, ...(stored.dealLensSettings || {}), ...(message.settings || {}) };
    settings.minimumScore = DealLens.normalizeMinimumScore(settings.minimumScore);
    await chrome.storage.local.set({ dealLensSettings: settings });
    await mergeListings([]);
    return { settings };
  });
  if (message?.type === "DEALLENS_RESTORE_DISMISSED") return respond(async () => { await restoreDismissed(); return { restored: true }; });
  if (message?.type === "DEALLENS_RESET_LEARNING") return respond(async () => {
    await chrome.storage.local.set({ dealLensPreferenceModel: { weights: {}, feedbackCount: 0 }, dealLensFeedback: {} });
    await mergeListings([]);
    return { reset: true };
  });
  if (message?.type === "DEALLENS_CLEAR_DATA") return respond(async () => {
    await chrome.storage.local.remove(["dealLensListings", "dealLensWatchlist", "dealLensCurrentScans", "dealLensScanStatuses"]);
    return { cleared: true };
  });
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
