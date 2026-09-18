(function initSidePanel() {
  "use strict";

  const DEFAULT_SETTINGS = { maxPrice: 30000, minimumScore: 55, defaultCosts: 500, keywords: "laptop, phone, console, camera", liveAnalysis: true };
  let state = { listings: [], currentIds: new Set(), currentScan: null, watchlist: new Set(), dismissed: new Set(), preferenceModel: { weights: {}, feedbackCount: 0 }, settings: DEFAULT_SETTINGS };

  const $ = selector => document.querySelector(selector);
  const money = value => Number.isFinite(value) ? `₱${Math.round(value).toLocaleString("en-PH")}` : "—";
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  }

  async function persistListings(items) {
    const protectedIds = [...state.watchlist, ...state.currentIds];
    const rows = DealLensStorage.pruneListings(Object.values(items || {}), protectedIds);
    return DealLensStorage.persist(chrome.storage.local, rows);
  }

  async function loadState() {
    const stored = await chrome.storage.local.get(["dealLensListings", "dealLensWatchlist", "dealLensSettings", "dealLensDismissed", "dealLensPreferenceModel", "dealLensLastScan", "dealLensSelectedId", "dealLensCurrentScan"]);
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.settings = { ...DEFAULT_SETTINGS, ...(stored.dealLensSettings || {}) };
    state.watchlist = new Set(stored.dealLensWatchlist || []);
    state.dismissed = new Set(stored.dealLensDismissed || []);
    state.preferenceModel = stored.dealLensPreferenceModel || { weights: {}, feedbackCount: 0 };
    state.currentScan = stored.dealLensCurrentScan || null;
    state.currentIds = new Set(state.currentScan?.tabId === activeTab?.id ? state.currentScan.ids || [] : []);
    state.listings = DealLensStorage.pruneListings(Object.values(stored.dealLensListings || {}), [...state.watchlist, ...state.currentIds]);
    state.listings.forEach(item => { item.analysis = DealLens.scoreListing(item, state.listings, state.settings, state.preferenceModel); });
    render();
    fillSettings();
    if (stored.dealLensLastScan) setScanStatus("success", stored.dealLensLastScan);
    if (stored.dealLensSelectedId) {
      const selected = state.listings.find(item => item.id === stored.dealLensSelectedId);
      await chrome.storage.local.remove(["dealLensSelectedId"]);
      if (selected) showDetails(selected);
    }
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
    const scoreClass = analysis.score >= 75 ? "" : analysis.score >= 55 ? "mid" : "low";
    const flags = [
      Date.now() - new Date(item.firstSeenAt).getTime() < 86400000 ? '<span class="flag">New</span>' : "",
      analysis.placeholder.value ? '<span class="flag warn">Price unverified</span>' : "",
      item.localAiAudit ? '<span class="flag ai">AI audited</span>' : "",
      analysis.scoreStatus === "valued" && analysis.score >= state.settings.minimumScore && !analysis.placeholder.value
        ? `<span class="flag good">Good deal ≥ ${state.settings.minimumScore}</span>`
        : analysis.scoreStatus === "provisional" && analysis.score >= state.settings.minimumScore
          ? '<span class="flag promising">Promising · verify value</span>'
          : analysis.scoreStatus === "provisional" ? '<span class="flag warn">Provisional · needs comps</span>' : `<span class="flag">Below ${state.settings.minimumScore}</span>`,
      analysis.trend.count ? `<span class="flag">${analysis.trend.count} comparable${analysis.trend.count === 1 ? "" : "s"}</span>` : '<span class="flag">Needs comparables</span>',
      analysis.risk.score >= 20 ? `<span class="flag warn">Risk ${analysis.risk.score}</span>` : "",
      `<span class="flag">${escapeHtml(analysis.category)}</span>`
    ].join("");
    return `
      <article class="listing-card" data-id="${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="Open details for ${escapeHtml(item.title)}">
        <div class="listing-top">
          ${item.image ? `<img class="listing-image" src="${escapeHtml(item.image)}" alt="">` : '<div class="listing-image"></div>'}
          <div><div class="listing-title">${escapeHtml(item.title)}</div><div class="listing-meta">${escapeHtml(item.location || analysis.category)}</div><div class="listing-price">${item.priceLabel ? escapeHtml(item.priceLabel) : money(item.price)}</div></div>
          <div class="score-bubble ${scoreClass}" title="${analysis.scoreStatus === "provisional" ? "Provisional score" : "Deal score"}">${analysis.placeholder.value ? "?" : analysis.scoreStatus === "provisional" ? `~${analysis.score}` : analysis.score}</div>
        </div>
        <div class="flag-row">${flags}</div>
        <div class="card-actions">
          <button data-action="details">Details</button>
          <button data-action="similar">Find similar</button>
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
    $("#emptyTitle").textContent = hasCurrent ? `No products meet the current ${state.settings.minimumScore}-point filter` : hasHistory ? "Scan this Marketplace page" : "No listings scanned yet";
    $("#emptyMessage").textContent = hasCurrent ? "Choose All on this page to review lower scores, or change the minimum score in Settings." : hasHistory ? "Your older scans are still available under All local history." : "DealLens analyzes only Marketplace results that are visible or loaded in your browser.";
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
        if (action === "details") showDetails(item);
        if (action === "similar") findSimilar(item);
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
    return `Hi! Is the ${item.title} still available? Could you confirm its exact model/specifications, condition, included accessories, and any defects or repairs? Is the listed price your best cash price? Thank you.`;
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
      <p class="fine-print">Audited locally ${new Date(audit.auditedAt).toLocaleString()}. This advisory does not change repair costs, reference value, or Deal Score automatically.</p>`;
  }

  function showDetails(item) {
    const a = item.analysis;
    const specs = Object.entries(a.specs || {}).map(([key, value]) => `<span class="flag">${escapeHtml(key)}: ${escapeHtml(value)}</span>`).join("") || '<span class="flag">No specifications detected</span>';
    $("#detailContent").innerHTML = `
      <div class="detail-score"><div class="score-bubble ${a.score >= 75 ? "" : a.score >= 55 ? "mid" : "low"}">${a.placeholder.value ? "?" : a.scoreStatus === "provisional" ? `~${a.score}` : a.score}</div><div><h3>${escapeHtml(item.title)}</h3><p class="listing-meta">${escapeHtml(a.category)} · ${item.priceLabel ? escapeHtml(item.priceLabel) : money(item.price)} · ${escapeHtml(a.scoreStatus)} · ${a.confidence}% confidence</p></div></div>
      <div class="metric-row"><div><strong>${money(a.trend.median)}</strong><span>Comparable median</span></div><div><strong>${money(a.expectedProfit)}</strong><span>Est. gross profit</span></div><div><strong>${a.trend.count}</strong><span>Comparables</span></div></div>
      <div class="detail-section"><h4>Score components</h4><div class="component-grid">${Object.entries(a.components).map(([name, value]) => `<div><span>${escapeHtml(name)}</span><strong>${value === null ? "—" : value}</strong></div>`).join("")}</div><p class="fine-print">A provisional score excludes market value and cannot be labeled a Good Deal. Scan similar items or enter a reference value to unlock a valued score.</p></div>
      <div class="detail-section"><h4>Why this score</h4><ul>${a.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></div>
      <div class="detail-section"><h4>Detected specifications</h4><div class="flag-row">${specs}</div></div>
      <div class="detail-section"><h4>Comparable asking-price range</h4><p>${a.trend.count ? `${money(a.trend.low)} – ${money(a.trend.high)} from ${a.trend.count} locally scanned similar listings.` : "Scan a similar-item search to build a local price range."}</p></div>
      <div class="detail-section ai-section"><h4>Local AI text audit <span class="local-pill">On-device</span></h4>
        <div id="aiAuditStatus" class="ai-status">Checking Chrome built-in AI availability…</div>
        <div id="aiAuditResult">${aiAuditMarkup(item.localAiAudit)}</div>
        <button id="runAiAudit" class="primary-button" disabled>${item.localAiAudit ? "Run audit again" : "Run local text audit"}</button>
        <p class="fine-print">Optional. Listing text stays on this device. DealLens rules continue working if local AI is unavailable.</p>
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
      <div class="detail-section"><h4>Suggested seller message</h4><div class="message-box">${escapeHtml(messageFor(item))}</div><div class="card-actions"><button id="copyMessage">Copy message</button><button id="openListing">Open listing</button></div></div>
      <p class="fine-print">Scores are estimates. Inspect the item, verify ownership and serial details, and do not pay before you are satisfied.</p>`;
    $("#copyMessage").addEventListener("click", async () => { await navigator.clipboard.writeText(messageFor(item)); showToast("Message copied"); });
    $("#openListing").addEventListener("click", () => chrome.tabs.create({ url: item.url }));
    $("#runAiAudit").addEventListener("click", () => runLocalAiAudit(item));
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
      const stored = await chrome.storage.local.get(["dealLensListings"]);
      const listings = stored.dealLensListings || {};
      listings[item.id] = { ...(listings[item.id] || {}), ...item, localAiAudit: audit };
      await persistListings(listings);
      const stateItem = state.listings.find(value => value.id === item.id);
      if (stateItem) stateItem.localAiAudit = audit;
      render();
      showDetails(item);
      showToast("Local AI audit complete");
    } catch (error) {
      statusElement.textContent = error.message || "The local AI audit failed.";
      statusElement.dataset.state = "error";
      button.disabled = false;
      button.textContent = item.localAiAudit ? "Run audit again" : "Run local text audit";
    }
  }

  async function saveListingFields(item, fields, confirmation) {
    Object.assign(item, fields);
    const stored = await chrome.storage.local.get(["dealLensListings"]);
    const listings = stored.dealLensListings || {};
    listings[item.id] = { ...(listings[item.id] || {}), ...item, ...fields };
    await persistListings(listings);
    await chrome.runtime.sendMessage({ type: "DEALLENS_RECALCULATE" });
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
    adding ? state.watchlist.add(id) : state.watchlist.delete(id);
    await chrome.storage.local.set({ dealLensWatchlist: [...state.watchlist] });
    if (adding) {
      const item = state.listings.find(row => row.id === id);
      if (item) await applyFeedback(item, 1);
    } else render();
  }

  async function applyFeedback(item, direction) {
    const weights = { ...(state.preferenceModel.weights || {}) };
    DealLens.preferenceSignals(item).forEach(signal => {
      const strength = signal.startsWith("category:") ? 1.2 : 0.45;
      weights[signal] = Math.max(-5, Math.min(5, (Number(weights[signal]) || 0) + direction * strength));
    });
    state.preferenceModel = { weights, feedbackCount: (Number(state.preferenceModel.feedbackCount) || 0) + 1 };
    await chrome.storage.local.set({ dealLensPreferenceModel: state.preferenceModel });
    await chrome.runtime.sendMessage({ type: "DEALLENS_RECALCULATE" });
    await loadState();
  }

  async function dismissListing(item) {
    state.dismissed.add(item.id);
    state.watchlist.delete(item.id);
    const stored = await chrome.storage.local.get(["dealLensListings"]);
    const listings = stored.dealLensListings || {};
    delete listings[item.id];
    await persistListings(listings);
    await chrome.storage.local.set({ dealLensDismissed: [...state.dismissed], dealLensWatchlist: [...state.watchlist] });
    await applyFeedback(item, -1);
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

    setScanStatus("scanning", "Connecting DealLens to this Marketplace tab…");
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
      await chrome.storage.local.set({ dealLensLastScan: status });
      setScanStatus(response?.found ? "success" : "error", status);
      showToast(response?.found ? `Scan complete: ${response.found} analyzed` : "No listing cards found");
    } catch (error) {
      const message = String(error?.message || "");
      const friendlyMessage = message.includes("Receiving end does not exist")
        ? "DealLens could not connect. Refresh the Marketplace tab once, then scan again."
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
  $("#filterInput").addEventListener("input", render);
  $("#scopeSelect").addEventListener("change", render);
  $("#sortSelect").addEventListener("change", render);
  $("#liveToggle").addEventListener("change", async event => {
    state.settings.liveAnalysis = event.target.checked;
    await chrome.storage.local.set({ dealLensSettings: state.settings });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "DEALLENS_LIVE", enabled: event.target.checked }).catch(() => {});
  });
  $("#settingsForm").addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.settings = { ...state.settings, maxPrice: Number(data.get("maxPrice")), minimumScore: Number(data.get("minimumScore")), defaultCosts: Number(data.get("defaultCosts")), keywords: String(data.get("keywords") || "") };
    await chrome.storage.local.set({ dealLensSettings: state.settings });
    await chrome.runtime.sendMessage({ type: "DEALLENS_RECALCULATE" });
    await loadState();
    showToast("Settings saved");
  });
  $("#clearData").addEventListener("click", async () => {
    if (!confirm("Clear all locally saved listing history and watchlist items?")) return;
    await chrome.storage.local.remove(["dealLensListings", "dealLensWatchlist", "dealLensLastScan", "dealLensCurrentScan"]);
    await loadState();
    showToast("Local listing data cleared");
  });
  $("#restoreDismissed").addEventListener("click", async () => {
    state.dismissed.clear();
    await chrome.storage.local.set({ dealLensDismissed: [] });
    render();
    showToast("Dismissed listings may appear on the next scan");
  });
  $("#resetLearning").addEventListener("click", async () => {
    state.preferenceModel = { weights: {}, feedbackCount: 0 };
    await chrome.storage.local.set({ dealLensPreferenceModel: state.preferenceModel });
    await chrome.runtime.sendMessage({ type: "DEALLENS_RECALCULATE" });
    await loadState();
    showToast("Personalization reset");
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "DEALLENS_UPDATED") loadState();
    if (message?.type === "DEALLENS_SHOW_DETAILS" && message.listingId) {
      loadState().then(() => {
        const item = state.listings.find(value => value.id === message.listingId);
        if (item) showDetails(item);
      });
    }
  });
  loadState();
})();
