(function initDealLensStorage(root) {
  "use strict";

  const MAX_LISTINGS = 350;
  const SCHEMA_VERSION = 2;

  function text(value, limit) {
    return String(value || "").slice(0, limit);
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function sanitizeImage(value) {
    const image = text(value, 1400);
    return /^https:\/\//i.test(image) ? image : "";
  }

  function sanitizeAudit(audit) {
    if (!audit || typeof audit !== "object") return undefined;
    return {
      summary: text(audit.summary, 600),
      confidence: number(audit.confidence) || 0,
      liquidityTier: text(audit.liquidityTier, 60),
      liquidityReason: text(audit.liquidityReason, 500),
      detectedSpecs: (audit.detectedSpecs || []).slice(0, 20).map(value => text(value, 120)),
      contradictions: (audit.contradictions || []).slice(0, 12).map(value => text(value, 300)),
      sellerQuestions: (audit.sellerQuestions || []).slice(0, 12).map(value => text(value, 300)),
      defects: (audit.defects || []).slice(0, 12).map(defect => ({
        label: text(defect?.label, 120),
        confidence: number(defect?.confidence) || 0,
        evidence: text(defect?.evidence, 300),
        repairCategory: text(defect?.repairCategory, 100)
      })),
      auditedAt: text(audit.auditedAt, 40)
    };
  }

  function sanitizeListing(item) {
    if (!item?.id) return null;
    const clean = {
      id: text(item.id, 160),
      url: text(item.url, 700),
      title: text(item.title, 180),
      text: text(item.text, 1800),
      price: number(item.price),
      priceLabel: text(item.priceLabel, 50),
      image: sanitizeImage(item.image),
      location: text(item.location, 140),
      capturedAt: text(item.capturedAt, 40),
      firstSeenAt: text(item.firstSeenAt, 40),
      lastSeenAt: text(item.lastSeenAt, 40),
      category: text(item.category, 60),
      specs: {
        ...(number(item.specs?.ramGb) !== null ? { ramGb: number(item.specs.ramGb) } : {}),
        ...(number(item.specs?.storageGb) !== null ? { storageGb: number(item.specs.storageGb) } : {}),
        ...(item.specs?.cpu ? { cpu: text(item.specs.cpu, 80) } : {}),
        ...(item.specs?.gpu ? { gpu: text(item.specs.gpu, 80) } : {}),
        ...(item.specs?.model ? { model: text(item.specs.model, 100) } : {})
      }
    };
    ["manualReferencePrice", "repairCost", "transportCost", "otherCost", "actualPurchasePrice", "actualResalePrice"].forEach(key => {
      const value = number(item[key]);
      if (value !== null) clean[key] = value;
    });
    const audit = sanitizeAudit(item.localAiAudit);
    if (audit) clean.localAiAudit = audit;
    return clean;
  }

  function pruneListings(items, protectedIds = [], maximum = MAX_LISTINGS) {
    const protectedSet = new Set(protectedIds || []);
    return (items || [])
      .map(sanitizeListing)
      .filter(Boolean)
      .sort((a, b) => {
        const protection = Number(protectedSet.has(b.id)) - Number(protectedSet.has(a.id));
        if (protection) return protection;
        return String(b.lastSeenAt || b.capturedAt).localeCompare(String(a.lastSeenAt || a.capturedAt));
      })
      .slice(0, maximum);
  }

  function listingMap(items) {
    return Object.fromEntries((items || []).map(item => [item.id, item]));
  }

  function isQuotaError(error) {
    return /quota|kQuotaBytes/i.test(String(error?.message || error || ""));
  }

  async function persist(storageArea, items, extraUpdates = {}) {
    const payload = { ...extraUpdates, dealLensListings: listingMap(items) };
    try {
      await storageArea.set(payload);
      return { recovered: false };
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      await storageArea.remove(["dealLensListings"]);
      await storageArea.set(payload);
      return { recovered: true };
    }
  }

  function mergeCurrentScan(previous, next) {
    if (!next) return { value: previous || null, changed: false };
    const samePage = previous?.tabId === next.tabId && previous?.pageKey && previous.pageKey === next.pageKey;
    const ids = samePage ? [...new Set([...(previous.ids || []), ...(next.ids || [])])] : [...new Set(next.ids || [])];
    const value = { ...next, ids };
    const changed = !previous
      || previous.tabId !== value.tabId
      || previous.pageKey !== value.pageKey
      || ids.length !== (previous.ids || []).length
      || ids.some((id, index) => id !== previous.ids[index]);
    return { value, changed };
  }

  function mergeTabScan(scans, next) {
    const values = { ...(scans || {}) };
    if (!next?.tabId) return { value: values, scan: null, changed: false };
    const key = String(next.tabId);
    const merged = mergeCurrentScan(values[key], next);
    values[key] = merged.value;
    return { value: values, scan: merged.value, changed: merged.changed };
  }

  function scanForTab(scans, tabId, legacyScan = null) {
    if (!tabId) return null;
    return scans?.[String(tabId)] || (legacyScan?.tabId === tabId ? legacyScan : null);
  }

  function statusForTab(statuses, tabId) {
    if (!tabId) return null;
    return statuses?.[String(tabId)] || null;
  }

  function mergeTabStatus(statuses, status) {
    const values = { ...(statuses || {}) };
    if (!status?.tabId) return values;
    values[String(status.tabId)] = {
      tabId: status.tabId,
      pageKey: text(status.pageKey, 700),
      found: Math.max(0, Number(status.found) || 0),
      newCount: Math.max(0, Number(status.newCount) || 0),
      scannedAt: text(status.scannedAt, 40)
    };
    return values;
  }

  function migrateStoredData(stored = {}) {
    const scans = { ...(stored.dealLensCurrentScans || {}) };
    if (stored.dealLensCurrentScan?.tabId && !scans[String(stored.dealLensCurrentScan.tabId)]) {
      scans[String(stored.dealLensCurrentScan.tabId)] = stored.dealLensCurrentScan;
    }
    return {
      dealLensSchemaVersion: SCHEMA_VERSION,
      dealLensCurrentScans: scans,
      dealLensScanStatuses: { ...(stored.dealLensScanStatuses || {}) },
      dealLensFeedback: { ...(stored.dealLensFeedback || {}) }
    };
  }

  function applyPreferenceFeedback(feedbackMap, preferenceModel, listingId, signals, direction) {
    const feedback = { ...(feedbackMap || {}) };
    const weights = { ...(preferenceModel?.weights || {}) };
    const previous = feedback[listingId] || { direction: 0, signals: [] };
    const adjust = (values, amount) => (values || []).forEach(signal => {
      const strength = String(signal).startsWith("category:") ? 1.2 : 0.45;
      weights[signal] = Math.max(-5, Math.min(5, (Number(weights[signal]) || 0) + amount * strength));
      if (Math.abs(weights[signal]) < 0.0001) delete weights[signal];
    });
    adjust(previous.signals, -Number(previous.direction || 0));
    if (direction) {
      const uniqueSignals = [...new Set(signals || [])];
      adjust(uniqueSignals, Number(direction));
      feedback[listingId] = { direction: Number(direction), signals: uniqueSignals };
    } else delete feedback[listingId];
    return { feedback, preferenceModel: { weights, feedbackCount: Object.keys(feedback).length } };
  }

  const api = { MAX_LISTINGS, SCHEMA_VERSION, sanitizeListing, sanitizeAudit, pruneListings, listingMap, isQuotaError, persist, mergeCurrentScan, mergeTabScan, scanForTab, statusForTab, mergeTabStatus, migrateStoredData, applyPreferenceFeedback };
  root.DealLensStorage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
