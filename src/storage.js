(function initDealLensStorage(root) {
  "use strict";

  const MAX_LISTINGS = 350;

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

  const api = { MAX_LISTINGS, sanitizeListing, sanitizeAudit, pruneListings, listingMap, isQuotaError, persist };
  root.DealLensStorage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
