(function initSidePanel() {
  "use strict";

  const DEFAULT_SETTINGS = { maxPrice: 30000, minimumScore: 5.5, defaultCosts: 500, keywords: "laptop, phone, console, camera", liveAnalysis: true, theme: "system" };
  let state = { listings: [], currentIds: new Set(), currentScan: null, currentStatus: null, watchlist: new Set(), dismissed: new Set(), preferenceModel: { weights: {}, feedbackCount: 0 }, settings: DEFAULT_SETTINGS };

  const $ = selector => document.querySelector(selector);
  const money = value => Number.isFinite(value) ? `₱${Math.round(value).toLocaleString("en-PH")}` : "—";
  const rating = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "—";
  const componentRating = value => Number.isFinite(Number(value)) ? (Number(value) / 10).toFixed(1) : "—";
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  let loadTimer = null;
  let loadQueue = Promise.resolve();
  let loadRequest = 0;

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function applyTheme(theme = "system") {
    document.documentElement.dataset.theme = ["light", "dark"].includes(theme) ? theme : "system";
  }

  async function mutate(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (response?.error) throw new Error(response.error);
    return response;
  }

  async function loadState() {
    const request = ++loadRequest;
    const [stored, tabs] = await Promise.all([
      chrome.storage.local.get(["dealLensListings", "dealLensWatchlist", "dealLensSettings", "dealLensDismissed", "dealLensPreferenceModel", "dealLensSelectedId", "dealLensCurrentScans", "dealLensScanStatuses"]),
      chrome.tabs.query({ active: true, currentWindow: true })
    ]);
    if (request !== loadRequest) return false;
    const [activeTab] = tabs;
    state.settings = { ...DEFAULT_SETTINGS, ...(stored.dealLensSettings || {}) };
    state.settings.minimumScore = DealLens.normalizeMinimumScore(state.settings.minimumScore);
    applyTheme(state.settings.theme);
    state.watchlist = new Set(stored.dealLensWatchlist || []);
    state.dismissed = new Set(stored.dealLensDismissed || []);
    state.preferenceModel = stored.dealLensPreferenceModel || { weights: {}, feedbackCount: 0 };
    state.currentScan = DealLensStorage.scanForTab(stored.dealLensCurrentScans, activeTab?.id);
    state.currentStatus = DealLensStorage.statusForTab(stored.dealLensScanStatuses, activeTab?.id);
    const activePageKey = DealLensScan.marketplacePageKey(activeTab?.url || "");
    const viewingItem = activePageKey.startsWith("/marketplace/item/");
    const scanMatchesPage = viewingItem || state.currentScan?.pageKey === activePageKey;
    state.currentIds = new Set(scanMatchesPage ? state.currentScan?.ids || [] : []);
    state.listings = DealLensStorage.pruneListings(Object.values(stored.dealLensListings || {}), [...state.watchlist, ...state.currentIds]);
    state.listings.forEach(item => { item.analysis = DealLens.scoreListing(item, state.listings, state.settings, state.preferenceModel); });
    render();
    fillSettings();
    updateBatchAiAvailability();
    if (scanMatchesPage && state.currentStatus) {
      const when = new Date(state.currentStatus.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setScanStatus(state.currentStatus.found ? "success" : "error", state.currentStatus.found
        ? `Found ${state.currentStatus.found} visible cards · ${state.currentStatus.newCount} new · ${when}`
        : `Scan finished · no listing cards detected · ${when}`);
    } else setScanStatus("idle", "Waiting for a scan on this Marketplace page");
    if (stored.dealLensSelectedId) {
      const selected = state.listings.find(item => item.id === stored.dealLensSelectedId);
      await chrome.storage.local.remove(["dealLensSelectedId"]);
      if (request !== loadRequest) return false;
      if (selected) showDetails(selected);
    }
    return true;
  }

  function scheduleLoadState() {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      loadQueue = loadQueue.catch(() => {}).then(loadState);
    }, 120);
  }

  function filteredListings(watchOnly = false) {
    const needle = $("#filterInput")?.value?.trim().toLowerCase() || "";
    let rows = state.listings.filter(item => watchOnly ? state.watchlist.has(item.id) : state.currentIds.has(item.id));
    if (!watchOnly) {
      const scope = $("#scopeSelect")?.value || "promising";
      if (scope === "history") rows = [...state.listings];
      if (scope === "promising") rows = rows.filter(item => item.analysis?.score >= state.settings.minimumScore && !item.analysis?.placeholder.value);
      if (scope === "good") rows = rows.filter(item => item.analysis?.scoreStatus === "valued" && item.analysis?.score >= state.settings.minimumScore && !item.analysis?.placeholder.value);
      if (scope === "flagged") rows = rows.filter(item => item.analysis?.placeholder.value || item.analysis?.risk.score >= 20);
    }
    if (needle) rows = rows.filter(item => `${item.title} ${item.text} ${item.category}`.toLowerCase().includes(needle));
    const sort = $("#sortSelect")?.value || "score";
    return rows.sort((a, b) => {
      if (sort === "priceLow") return (a.price ?? Infinity) - (b.price ?? Infinity);
      if (sort === "newest") return String(b.firstSeenAt).localeCompare(String(a.firstSeenAt));
      if (sort === "profit") return (b.analysis?.expectedProfit ?? -Infinity) - (a.analysis?.expectedProfit ?? -Infinity);
      if (sort === "risk") return (a.analysis?.risk.score ?? 100) - (b.analysis?.risk.score ?? 100);
      return (b.analysis?.score || 0) - (a.analysis?.score || 0);
    });
  }

  function card(item) {
    const analysis = item.analysis || DealLens.scoreListing(item, state.listings, state.settings);
    const scoreClass = analysis.score >= 7.5 ? "" : analysis.score >= 5.5 ? "mid" : "low";
    const flags = [
      Date.now() - new Date(item.firstSeenAt).getTime() < 86400000 ? '<span class="flag">New</span>' : "",
      analysis.placeholder.value ? '<span class="flag warn">Price unverified</span>' : "",
      item.localAiAudit ? '<span class="flag ai">AI audited</span>' : "",
      item.visualAudit ? '<span class="flag ai">Visual audit</span>' : "",
      analysis.priceBait.detected ? '<span class="flag warn">Price bait</span>' : "",
      analysis.fatalFlags.length ? '<span class="flag warn">Hard pass flag</span>' : "",
      analysis.scoreStatus === "valued" && analysis.score >= state.settings.minimumScore && !analysis.placeholder.value
        ? `<span class="flag good">Good deal ≥ ${rating(state.settings.minimumScore)}</span>`
        : analysis.scoreStatus === "provisional" && analysis.score >= state.settings.minimumScore
          ? '<span class="flag promising">Promising · verify value</span>'
          : analysis.scoreStatus === "provisional" ? '<span class="flag warn">Provisional · needs comps</span>' : `<span class="flag">Below ${rating(state.settings.minimumScore)}</span>`,
      analysis.trend.sufficient ? `<span class="flag">${analysis.trend.count} strong comparables</span>` : `<span class="flag warn">${analysis.trend.count}/${DealLens.MIN_COMPARABLES} comparables</span>`,
      analysis.referenceValue ? `<span class="flag">Reference ${money(analysis.referenceValue)}</span>` : "",
      `<span class="flag">Match ${rating(analysis.matchScore)}</span>`,
      `<span class="flag">Condition ${componentRating(analysis.condition.score)}</span>`,
      analysis.risk.score >= 20 ? `<span class="flag warn">Risk ${componentRating(analysis.risk.score)}</span>` : "",
      `<span class="flag">${escapeHtml(analysis.category)}</span>`
    ].join("");
    return `
      <article class="listing-card" data-id="${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="Open details for ${escapeHtml(item.title)}">
        <div class="listing-top">
          ${item.image ? `<img class="listing-image" src="${escapeHtml(item.image)}" alt="">` : '<div class="listing-image"></div>'}
          <div><div class="listing-title">${escapeHtml(item.title)}</div><div class="listing-meta">${escapeHtml(item.location || analysis.category)}</div><div class="listing-price">${item.priceLabel ? escapeHtml(item.priceLabel) : money(item.price)}</div></div>
          <div class="score-bubble ${scoreClass}" title="${analysis.scoreEngine === "hybrid-ai" ? "AI-enhanced Deal Score" : analysis.scoreStatus === "provisional" ? "Provisional local score" : "Local Deal Score"}">${analysis.placeholder.value ? "?" : analysis.scoreStatus === "provisional" ? `~${rating(analysis.score)}` : rating(analysis.score)}</div>
        </div>
        <div class="flag-row">${flags}</div>
        <div class="card-actions">
          <button data-action="similar">Find similar</button>
          <button data-action="negotiate">Negotiate</button>
          <button data-action="watch">${state.watchlist.has(item.id) ? "Unsave" : "Watch"}</button>
          <button data-action="dismiss">Remove</button>
        </div>
      </article>`;
  }

  function render() {
    const rows = filteredListings(false);
    const currentRows = state.listings.filter(item => state.currentIds.has(item.id));
    const promisingRows = currentRows.filter(item => item.analysis?.score >= state.settings.minimumScore && !item.analysis?.placeholder.value);
    $("#listingList").innerHTML = rows.map(card).join("");
    $("#emptyState").style.display = rows.length ? "none" : "block";
    const hasCurrent = currentRows.length > 0;
    const hasHistory = state.listings.length > 0;
    $("#emptyTitle").textContent = hasCurrent ? `No products meet the current ${rating(state.settings.minimumScore)}/10 filter` : hasHistory ? "Scan this Marketplace page" : "No listings scanned yet";
    $("#emptyMessage").textContent = hasCurrent ? "Choose All on this page to review lower scores, or change the minimum score in Settings." : hasHistory ? "Your older scans are still available under All local history." : "Deal Breaker analyzes only Marketplace results that are visible or loaded in your browser.";
    const watches = filteredListings(true);
    $("#watchlistList").innerHTML = watches.map(card).join("");
    $("#watchEmpty").style.display = watches.length ? "none" : "block";
    $("#totalCount").textContent = currentRows.length;
    $("#dealCount").textContent = promisingRows.length;
    $("#riskCount").textContent = currentRows.filter(item => item.analysis?.placeholder.value || item.analysis?.risk.score >= 20).length;
    $("#dismissedCount").textContent = state.dismissed.size;
    $("#learningStatus").textContent = state.preferenceModel.feedbackCount ? `Learned from ${state.preferenceModel.feedbackCount} decision${state.preferenceModel.feedbackCount === 1 ? "" : "s"}` : "No feedback yet";
    $("#scanHeadline").textContent = hasCurrent ? `${currentRows.length} products on this page` : "Ready to inspect this page";
    $("#scanDetail").textContent = hasHistory ? `${state.listings.length} saved locally for comparisons. Scores improve as you scan similar items.` : "Open Marketplace results, then scan what is loaded.";
    bindCardActions();
  }

  function bindCardActions() {
    document.querySelectorAll(".listing-card button").forEach(button => {
      button.addEventListener("click", () => {
        const item = state.listings.find(row => row.id === button.closest(".listing-card").dataset.id);
        if (!item) return;
        const action = button.dataset.action;
        if (action === "similar") findSimilar(item);
        if (action === "negotiate") negotiate(item);
        if (action === "watch") toggleWatch(item.id);
        if (action === "dismiss") dismissListing(item);
      });
    });
    document.querySelectorAll(".listing-card").forEach(cardElement => {
      const open = () => {
        const item = state.listings.find(row => row.id === cardElement.dataset.id);
        if (item) showDetails(item);
      };
      cardElement.addEventListener("click", event => { if (!event.target.closest("button")) open(); });
      cardElement.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
    });
  }

  function messageFor(item) {
    const analysis = item.analysis;
    const specs = Object.values(analysis.specs || {}).filter(Boolean).join(", ");
    if (analysis.placeholder.value) return `Hi! What is the actual cash price for the ${item.title}? Is it still available? Please confirm the exact model, specifications${specs ? ` (${specs})` : ""}, condition, and any defects. Thank you.`;
    const offer = analysis.suggestedOffer ? ` I can offer ${money(analysis.suggestedOffer)} cash after testing` : " What is your best cash price";
    return `Hi! Is the ${item.title} still available?${offer}? Could you confirm its exact model/specifications, condition, included accessories, and any defects or repairs? Thank you.`;
  }

  async function negotiate(item) {
    await navigator.clipboard.writeText(messageFor(item));
    await chrome.tabs.create({ url: item.url });
    showToast("Offer copied — open Messenger and paste it");
  }

  function checklistFor(category) {
    const common = ["Confirm the serial/model number matches the listing", "Test all included accessories and ports", "Check proof of ownership before payment"];
    const categoryItems = {
      Laptop: ["Run a battery-health report", "Check keyboard, screen, Wi-Fi, webcam, and charger", "Verify CPU, RAM, storage, and GPU in system settings"],
      Phone: ["Check IMEI and account/activation locks", "Test cameras, speakers, charging, signal, and battery health", "Inspect the screen and frame for replacement parts"],
      Console: ["Test a game, controller, network connection, and disc drive", "Check account locks and included cables", "Listen for overheating or unusual fan noise"],
      Camera: ["Check shutter count and sensor condition", "Test autofocus, controls, card slot, flash, and battery", "Inspect lens glass for fungus or haze"]
    };
    return [...(categoryItems[category] || ["Test every major function before paying"]), ...common];
  }

  function aiAuditMarkup(audit) {
    if (!audit) return '<p class="ai-empty">No local AI audit has been run for this listing.</p>';
    const defects = audit.defects.length
      ? `<ul>${audit.defects.map(defect => `<li><strong>${escapeHtml(defect.label)}</strong> (${Math.round(defect.confidence * 100)}%): “${escapeHtml(defect.evidence)}” <span class="flag">${escapeHtml(defect.repairCategory)}</span></li>`).join("")}</ul>`
      : "<p>No text-supported defects were identified.</p>";
    return `
      <div class="ai-verdict"><strong>${escapeHtml(audit.summary)}</strong><span>Confidence ${Math.round(audit.confidence * 100)}%</span></div>
      <p><strong>Advisory liquidity:</strong> ${escapeHtml(audit.liquidityTier)} — ${escapeHtml(audit.liquidityReason || "No reliable reason provided")}</p>
      <h5>Evidence-backed defect signals</h5>${defects}
      ${audit.detectedSpecs.length ? `<h5>Detected specifications</h5><div class="flag-row">${audit.detectedSpecs.map(spec => `<span class="flag">${escapeHtml(spec)}</span>`).join("")}</div>` : ""}
      ${audit.contradictions.length ? `<h5>Possible contradictions</h5><ul>${audit.contradictions.map(value => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : ""}
      ${audit.sellerQuestions.length ? `<h5>Questions to verify</h5><ul>${audit.sellerQuestions.map(value => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : ""}
      <p class="fine-print">Audited locally ${new Date(audit.auditedAt).toLocaleString()}. The bounded AI score adjustment is shown above; repair costs and reference values remain unchanged.</p>`;
  }

  function visualAuditMarkup(audit) {
    if (!audit) return '<p class="ai-empty">No cloud visual audit has been run. Selected images are sent only when you click Audit visuals.</p>';
    const defects = audit.possibleDefects?.length
      ? audit.possibleDefects.map(defect => `<label class="visual-finding"><input type="checkbox" data-visual-id="${escapeHtml(defect.id)}" ${defect.confirmed ? "checked" : ""}><span><strong>Possible: ${escapeHtml(defect.label)}</strong> · ${Math.round(defect.confidence * 100)}%<br>${escapeHtml(defect.evidence)}${defect.suggestedCost ? ` · suggested reserve ${money(defect.suggestedCost)}` : ""}</span></label>`).join("")
      : "<p>No image-supported possible defects were returned.</p>";
    return `<div class="ai-verdict"><strong>${escapeHtml(audit.summary)}</strong><span>Visual condition ${componentRating(audit.visualConditionScore)}/10</span></div>${defects}${audit.hardwareFlags?.length ? `<h5>Hardware flags</h5><ul>${audit.hardwareFlags.map(value => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : ""}<p class="fine-print">Unchecked findings do not affect costs or scores. Confirm only what you can verify from the original photos or in person.</p>`;
  }

  function showDetails(item) {
    const a = item.analysis;
    const specs = Object.entries(a.specs || {}).map(([key, value]) => `<span class="flag">${escapeHtml(key)}: ${escapeHtml(value)}</span>`).join("") || '<span class="flag">No specifications detected</span>';
    $("#detailContent").innerHTML = `
      <div class="detail-score"><div class="score-bubble ${a.score >= 7.5 ? "" : a.score >= 5.5 ? "mid" : "low"}">${a.placeholder.value ? "?" : a.scoreStatus === "provisional" ? `~${rating(a.score)}` : rating(a.score)}</div><div><h3>${escapeHtml(item.title)}</h3><p class="listing-meta">${escapeHtml(a.category)} · ${item.priceLabel ? escapeHtml(item.priceLabel) : money(item.price)} · ${a.scoreEngine === "hybrid-ai" ? `AI-enhanced (${a.aiAdjustment >= 0 ? "+" : ""}${rating(a.aiAdjustment)})` : "rules-only"} · ${a.confidence}% ${escapeHtml(a.confidenceLabel)} confidence</p><p class="listing-meta">Match ${rating(a.matchScore)}/10 · Risk ${componentRating(a.risk.score)}/10 · Freshness ${rating(a.freshness.score)}/10</p></div></div>
      <p class="recommendation"><strong>${escapeHtml(a.recommendation)}</strong></p>
      ${a.priceBait.detected ? `<div class="price-alert"><strong>Possible price bait</strong><span>Displayed ${money(a.priceBait.displayedPrice)} · description ${money(a.priceBait.descriptionPrice)}. Calculations use the higher price.</span></div>` : ""}
      <div class="metric-row"><div><strong>${money(a.referenceValue)}</strong><span>${a.referenceSource === "manual" ? "Manual reference" : "Comparable reference"}</span></div><div><strong>${money(a.priceBait.effectivePrice)}</strong><span>Effective buy price</span></div><div><strong>${money(a.repairReserve)}</strong><span>${a.repairReserveSource === "manual" ? "Manual repair" : "Suggested repair reserve"}</span></div><div><strong>${money(a.expectedProfit)}</strong><span>Projected net</span></div><div><strong>${a.roi === null ? "—" : `${a.roi.toFixed(1)}%`}</strong><span>Projected ROI</span></div></div>
      <div class="detail-section"><h4>Deal Score components · 1–10</h4><div class="component-grid">${Object.entries(a.components).map(([name, value]) => `<div><span>${escapeHtml(name)}</span><strong>${value === null ? "—" : componentRating(value)}</strong></div>`).join("")}</div><p class="fine-print">Personal interests are shown as a separate Match Score and never inflate financial deal quality. A provisional score excludes market value and cannot be labeled a Good Deal.</p></div>
      <div class="detail-section"><h4>Why this score</h4><ul>${a.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></div>
      <div class="detail-section"><h4>Condition · ${componentRating(a.condition.score)}/10</h4><p><strong>${escapeHtml(a.condition.label)}</strong></p><ul>${a.condition.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></div>
      <div class="detail-section"><h4>Scam and red-flag check · ${componentRating(a.risk.score)}/10 risk</h4>${a.risk.reasons.length ? `<ul>${a.risk.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : "<p>No explicit text-based red flags detected. Still verify ownership and inspect before paying.</p>"}</div>
      <div class="detail-section"><h4>Detected specifications</h4><div class="flag-row">${specs}</div></div>
      ${a.categoryAudit.notes.length ? `<div class="detail-section"><h4>Category checks</h4><ul>${a.categoryAudit.notes.map(note => `<li>${escapeHtml(note)}</li>`).join("")}</ul></div>` : ""}
      ${a.repairSignals.length ? `<div class="detail-section"><h4>Suggested repair reserves</h4><ul>${a.repairSignals.map(signal => `<li>${escapeHtml(signal.label)}: ${money(signal.low)}–${money(signal.high)} (using ${money(signal.suggested)} until edited) · “${escapeHtml(signal.evidence)}”</li>`).join("")}</ul></div>` : ""}
      <div class="detail-section"><h4>Comparable asking-price evidence</h4><p>${a.trend.sufficient ? `${money(a.trend.low)} – ${money(a.trend.high)} from ${a.trend.count} strong locally scanned listings (${escapeHtml(a.trend.quality)} evidence).` : `${a.trend.count} usable comparable${a.trend.count === 1 ? "" : "s"}; at least ${DealLens.MIN_COMPARABLES} are required before DealLens displays a market range. Scan more exact-model results.`}${a.trend.rejectedCount ? ` ${a.trend.rejectedCount} price outlier${a.trend.rejectedCount === 1 ? " was" : "s were"} excluded.` : ""}</p></div>
      <div class="detail-section ai-section"><h4>Local AI text audit <span class="local-pill">On-device</span></h4>
        <div id="aiAuditStatus" class="ai-status">Checking Chrome built-in AI availability…</div>
        <div id="aiAuditResult">${aiAuditMarkup(item.localAiAudit)}</div>
        <button id="runAiAudit" class="primary-button" disabled>${item.localAiAudit ? "Run audit again" : "Run local text audit"}</button>
        <p class="fine-print">Optional. Listing text stays on this device. A completed audit can adjust the 10-point score by at most +0.5 or −1.8; placeholder-price safeguards still apply.</p>
      </div>
      <div class="detail-section ai-section"><h4>Optional photo audit <span class="cloud-pill">BYOK cloud</span></h4>
        <p class="warning-copy"><strong>Privacy warning:</strong> photos you choose will be uploaded to Google Gemini for analysis. Your key is kept only in Chrome session storage and is forgotten when Chrome ends. No images are saved by Deal Breaker.</p>
        <div class="edit-grid"><label>Gemini API key<input id="visionApiKey" type="password" autocomplete="off" placeholder="Session only"></label><label>Listing photos / screenshots<input id="visionFiles" type="file" accept="image/*" multiple></label></div>
        <div id="visualAuditResult">${visualAuditMarkup(item.visualAudit)}</div>
        <div class="card-actions"><button id="runVisualAudit">Audit visuals</button><button id="saveVisualConfirmations" ${item.visualAudit ? "" : "disabled"}>Save confirmations</button><button id="forgetVisionKey">Forget key</button></div>
        <div id="visionStatus" class="ai-status">AI findings are advisory until you confirm them.</div>
      </div>
      <div class="detail-section"><h4>Edit valuation and costs</h4><div class="edit-grid">
        <label>Reference value<input id="referencePrice" type="number" min="0" value="${item.manualReferencePrice || ""}" placeholder="${a.trend.median || ""}"></label>
        <label>Repair<input id="repairCost" type="number" min="0" value="${item.repairCost || ""}" placeholder="0"></label>
        <label>Transport<input id="transportCost" type="number" min="0" value="${item.transportCost || ""}" placeholder="0"></label>
      </div><button id="saveEstimate" class="primary-button">Save estimate</button></div>
      <div class="detail-section"><h4>Inspection checklist</h4><ul>${checklistFor(a.category).map(value => `<li>${escapeHtml(value)}</li>`).join("")}</ul></div>
      <div class="detail-section"><h4>Record your outcome</h4><div class="edit-grid">
        <label>Paid price<input id="actualPurchase" type="number" min="0" value="${item.actualPurchasePrice || ""}"></label>
        <label>Resale price<input id="actualResale" type="number" min="0" value="${item.actualResalePrice || ""}"></label>
      </div><button id="saveOutcome" class="primary-button secondary">Save outcome</button>${item.actualPurchasePrice && item.actualResalePrice ? `<p>Recorded realized profit: <strong>${money(item.actualResalePrice - item.actualPurchasePrice)}</strong></p>` : ""}</div>
      <div class="detail-section"><h4>Suggested negotiation message</h4><div class="message-box">${escapeHtml(messageFor(item))}</div><div class="card-actions"><button id="negotiateNow">Copy offer & open listing</button><button id="copyMessage">Copy only</button></div></div>
      <p class="fine-print">Scores are estimates. Inspect the item, verify ownership and serial details, and do not pay before you are satisfied.</p>`;
    $("#copyMessage").addEventListener("click", async () => { await navigator.clipboard.writeText(messageFor(item)); showToast("Message copied"); });
    $("#negotiateNow").addEventListener("click", () => negotiate(item));
    $("#runAiAudit").addEventListener("click", () => runLocalAiAudit(item));
    $("#runVisualAudit").addEventListener("click", () => runVisualAudit(item));
    $("#saveVisualConfirmations").addEventListener("click", () => saveVisualConfirmations(item));
    $("#forgetVisionKey").addEventListener("click", async () => { await chrome.storage.session.remove("dealBreakerGeminiKey"); $("#visionApiKey").value = ""; showToast("Session key forgotten"); });
    $("#saveEstimate").addEventListener("click", () => saveListingFields(item, {
      manualReferencePrice: Number($("#referencePrice").value) || null,
      repairCost: Number($("#repairCost").value) || 0,
      transportCost: Number($("#transportCost").value) || 0
    }, "Estimate saved"));
    $("#saveOutcome").addEventListener("click", () => saveListingFields(item, {
      actualPurchasePrice: Number($("#actualPurchase").value) || null,
      actualResalePrice: Number($("#actualResale").value) || null
    }, "Outcome saved"));
    if (!$("#detailDialog").open) $("#detailDialog").showModal();
    updateAiAvailability();
    chrome.storage.session.get("dealBreakerGeminiKey").then(value => { if ($("#visionApiKey")) $("#visionApiKey").value = value.dealBreakerGeminiKey || ""; });
  }

  async function imageData(file) {
    if (!file.type.startsWith("image/")) throw new Error("Only image files can be audited.");
    if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is larger than 8 MB.`);
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    return { mimeType: file.type, data: String(dataUrl).split(",")[1] };
  }

  async function runVisualAudit(item) {
    const button = $("#runVisualAudit");
    const status = $("#visionStatus");
    const apiKey = $("#visionApiKey").value.trim();
    const files = [...$("#visionFiles").files].slice(0, 4);
    button.disabled = true;
    status.textContent = "Preparing selected images…";
    try {
      await DealBreakerVision.ensurePermission();
      await chrome.storage.session.set({ dealBreakerGeminiKey: apiKey });
      const images = await Promise.all(files.map(imageData));
      status.textContent = "Uploading selected images to Gemini for a cautious visual review…";
      const visualAudit = await DealBreakerVision.audit({ apiKey, listing: item, images });
      await mutate({ type: "DEALLENS_UPDATE_LISTINGS", patches: [{ listingId: item.id, patch: { visualAudit } }] });
      await loadState();
      const updated = state.listings.find(value => value.id === item.id);
      if (updated) showDetails(updated);
      showToast("Visual audit complete — review and confirm findings");
    } catch (error) {
      status.textContent = error?.message || "Visual audit failed.";
      status.dataset.state = "error";
      button.disabled = false;
    }
  }

  async function saveVisualConfirmations(item) {
    if (!item.visualAudit) return;
    const checked = new Set([...document.querySelectorAll("[data-visual-id]:checked")].map(input => input.dataset.visualId));
    const visualAudit = { ...item.visualAudit, possibleDefects: item.visualAudit.possibleDefects.map(defect => ({ ...defect, confirmed: checked.has(defect.id) })) };
    await mutate({ type: "DEALLENS_UPDATE_LISTINGS", patches: [{ listingId: item.id, patch: { visualAudit } }] });
    await loadState();
    const updated = state.listings.find(value => value.id === item.id);
    if (updated) showDetails(updated);
    showToast("Confirmed visual findings saved");
  }

  async function updateAiAvailability() {
    const button = $("#runAiAudit");
    const statusElement = $("#aiAuditStatus");
    if (!button || !statusElement) return;
    const availability = await DealLensAI.availability();
    const messages = {
      available: "Local model ready.",
      downloadable: "Local model supported; Chrome will download it after you click Audit.",
      downloading: "Chrome is downloading the local model.",
      unavailable: "This device does not meet Chrome's local AI requirements.",
      unsupported: "Built-in AI is unavailable in this Chrome version or device."
    };
    statusElement.textContent = messages[availability] || `Local AI status: ${availability}`;
    statusElement.dataset.state = availability;
    button.disabled = availability === "unavailable" || availability === "unsupported";
  }

  async function runLocalAiAudit(item) {
    const button = $("#runAiAudit");
    const statusElement = $("#aiAuditStatus");
    button.disabled = true;
    button.textContent = "Preparing local model…";
    try {
      const audit = await DealLensAI.auditListing(item, {
        onProgress(percent) {
          if (statusElement) statusElement.textContent = `Downloading local model: ${percent}%`;
        },
        onStatus(status) {
          if (!statusElement) return;
          statusElement.textContent = status === "auditing" ? "Auditing listing text on this device…" : `Local AI: ${status}`;
        }
      });
      item.localAiAudit = audit;
      await mutate({ type: "DEALLENS_UPDATE_LISTINGS", patches: [{ listingId: item.id, patch: { localAiAudit: audit } }] });
      await loadState();
      const stateItem = state.listings.find(value => value.id === item.id);
      if (stateItem) showDetails(stateItem);
      showToast("Local AI audit complete");
    } catch (error) {
      statusElement.textContent = error.message || "The local AI audit failed.";
      statusElement.dataset.state = "error";
      button.disabled = false;
      button.textContent = item.localAiAudit ? "Run audit again" : "Run local text audit";
    }
  }

  async function updateBatchAiAvailability() {
    const button = $("#batchAiButton");
    if (!button) return;
    const availability = await DealLensAI.availability();
    const supported = availability !== "unsupported" && availability !== "unavailable";
    button.disabled = !supported || !state.currentIds.size;
    button.textContent = supported ? "AI-audit current batch" : "On-device AI unavailable";
  }

  async function runBatchAiAudit() {
    const button = $("#batchAiButton");
    const candidates = state.listings.filter(item => state.currentIds.has(item.id) && !item.localAiAudit);
    if (!candidates.length) {
      showToast(state.currentIds.size ? "Every current listing is already AI-audited" : "Scan a Marketplace results page first");
      return;
    }
    button.disabled = true;
    let completed = 0;
    try {
      for (const item of candidates) {
        button.textContent = `AI auditing ${completed + 1}/${candidates.length}…`;
        item.localAiAudit = await DealLensAI.auditListing(item, {
          onProgress(percent) { button.textContent = `Downloading AI model · ${percent}%`; }
        });
        completed += 1;
      }
      await mutate({ type: "DEALLENS_UPDATE_LISTINGS", patches: candidates.slice(0, completed).map(item => ({ listingId: item.id, patch: { localAiAudit: item.localAiAudit } })) });
      await loadState();
      showToast(`AI audit complete for ${completed} listing${completed === 1 ? "" : "s"}`);
    } catch (error) {
      if (completed) {
        await mutate({ type: "DEALLENS_UPDATE_LISTINGS", patches: candidates.slice(0, completed).map(item => ({ listingId: item.id, patch: { localAiAudit: item.localAiAudit } })) });
        await loadState();
      }
      showToast(error?.message || "Batch AI audit failed");
    } finally {
      button.disabled = false;
      button.textContent = "AI-audit current batch";
    }
  }

  async function saveListingFields(item, fields, confirmation) {
    await mutate({ type: "DEALLENS_UPDATE_LISTINGS", patches: [{ listingId: item.id, patch: fields }] });
    await loadState();
    $("#detailDialog").close();
    showToast(confirmation);
  }

  async function findSimilar(item) {
    const query = DealLens.buildSearchQuery(item);
    await chrome.tabs.create({ url: `https://www.facebook.com/marketplace/search?query=${encodeURIComponent(query)}` });
    showToast("Similar-item search opened");
  }

  async function toggleWatch(id) {
    const adding = !state.watchlist.has(id);
    await mutate({ type: "DEALLENS_SET_WATCH", listingId: id, watched: adding });
    await loadState();
  }

  async function dismissListing(item) {
    await mutate({ type: "DEALLENS_DISMISS", listingId: item.id, listing: item });
    await loadState();
    showToast("Removed and used as preference feedback");
  }

  function setScanStatus(status, message) {
    $("#scanStatus").dataset.state = status;
    $("#scanStatusText").textContent = message;
  }

  function isMarketplaceUrl(value) {
    try {
      const url = new URL(value);
      const isFacebook = url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com");
      return url.protocol === "https:" && isFacebook && (url.pathname === "/marketplace" || url.pathname.startsWith("/marketplace/"));
    } catch {
      return false;
    }
  }

  async function ensureContentScanner(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "DEALLENS_PING" });
      if (response?.ready) return;
    } catch {
      // The tab may predate an extension reload, so install a fresh scanner below.
    }

    setScanStatus("scanning", "Connecting Deal Breaker to this Marketplace tab…");
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["styles/content.css"] }).catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/scoring.js", "src/scan-coordinator.js", "src/content.js"] });
  }

  async function scanActiveTab() {
    const button = $("#scanButton");
    button.disabled = true;
    button.textContent = "Scanning…";
    setScanStatus("scanning", "Reading loaded Marketplace cards…");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !isMarketplaceUrl(tab.url)) throw new Error("Open a Facebook Marketplace page first.");
      await ensureContentScanner(tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, { type: "DEALLENS_SCAN" });
      if (response?.error) throw new Error(response.error);
      await new Promise(resolve => setTimeout(resolve, 350));
      await loadState();
      const storageNote = response?.storageRecovered ? " · storage cleaned" : "";
      const status = response?.found
        ? `Found ${response.found} visible cards · ${response.newCount || 0} new${storageNote} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "Scan finished · no listing cards detected";
      setScanStatus(response?.found ? "success" : "error", status);
      showToast(response?.found ? `Scan complete: ${response.found} analyzed` : "No listing cards found");
    } catch (error) {
      const message = String(error?.message || "");
      const friendlyMessage = message.includes("Receiving end does not exist")
        ? "Deal Breaker could not connect. Refresh the Marketplace tab once, then scan again."
        : message || "Could not scan this page";
      setScanStatus("error", friendlyMessage);
      showToast(friendlyMessage);
    } finally {
      button.disabled = false;
      button.textContent = "Scan loaded results";
    }
  }

  function fillSettings() {
    const form = $("#settingsForm");
    Object.entries(state.settings).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value; });
    $("#liveToggle").checked = state.settings.liveAnalysis !== false;
  }

  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab, .panel").forEach(element => element.classList.remove("active"));
    tab.classList.add("active");
    $(`#${tab.dataset.tab}Panel`).classList.add("active");
  }));
  $("#scanButton").addEventListener("click", scanActiveTab);
  $("#batchAiButton").addEventListener("click", runBatchAiAudit);
  $("#filterInput").addEventListener("input", render);
  $("#scopeSelect").addEventListener("change", render);
  $("#sortSelect").addEventListener("change", render);
  $("#liveToggle").addEventListener("change", async event => {
    state.settings.liveAnalysis = event.target.checked;
    await mutate({ type: "DEALLENS_SAVE_SETTINGS", settings: { liveAnalysis: event.target.checked } });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "DEALLENS_LIVE", enabled: event.target.checked }).catch(() => {});
  });
  $("#settingsForm").addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.settings = { ...state.settings, maxPrice: Number(data.get("maxPrice")), minimumScore: DealLens.normalizeMinimumScore(data.get("minimumScore")), defaultCosts: Number(data.get("defaultCosts")), keywords: String(data.get("keywords") || ""), theme: String(data.get("theme") || "system") };
    applyTheme(state.settings.theme);
    await mutate({ type: "DEALLENS_SAVE_SETTINGS", settings: state.settings });
    await loadState();
    showToast("Settings saved");
  });
  $("#clearData").addEventListener("click", async () => {
    if (!confirm("Clear all locally saved listing history and watchlist items?")) return;
    await mutate({ type: "DEALLENS_CLEAR_DATA" });
    await loadState();
    showToast("Local listing data cleared");
  });
  $("#restoreDismissed").addEventListener("click", async () => {
    await mutate({ type: "DEALLENS_RESTORE_DISMISSED" });
    await loadState();
    showToast("Dismissed listings may appear on the next scan");
  });
  $("#resetLearning").addEventListener("click", async () => {
    await mutate({ type: "DEALLENS_RESET_LEARNING" });
    await loadState();
    showToast("Personalization reset");
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "DEALLENS_UPDATED") scheduleLoadState();
    if (message?.type === "DEALLENS_SHOW_DETAILS" && message.listingId) {
      loadState().then(() => {
        const item = state.listings.find(value => value.id === message.listingId);
        if (item) showDetails(item);
      });
    }
  });
  chrome.tabs.onActivated.addListener(scheduleLoadState);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.active && (changeInfo.url || changeInfo.status === "complete")) scheduleLoadState();
  });
  loadState();
})();
