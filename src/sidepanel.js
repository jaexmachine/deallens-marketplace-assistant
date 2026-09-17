(function initSidePanel() {
  "use strict";

  const DEFAULT_SETTINGS = { maxPrice: 30000, minimumScore: 55, defaultCosts: 500, keywords: "laptop, phone, console, camera", liveAnalysis: true };
  let state = { listings: [], watchlist: new Set(), settings: DEFAULT_SETTINGS };

  const $ = selector => document.querySelector(selector);
  const money = value => Number.isFinite(value) ? `₱${Math.round(value).toLocaleString("en-PH")}` : "—";
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  }

  async function loadState() {
    const stored = await chrome.storage.local.get(["dealLensListings", "dealLensWatchlist", "dealLensSettings"]);
    state.settings = { ...DEFAULT_SETTINGS, ...(stored.dealLensSettings || {}) };
    state.listings = Object.values(stored.dealLensListings || {});
    state.watchlist = new Set(stored.dealLensWatchlist || []);
    state.listings.forEach(item => { item.analysis = DealLens.scoreListing(item, state.listings, state.settings); });
    render();
    fillSettings();
  }

  function filteredListings(watchOnly = false) {
    const needle = $("#filterInput")?.value?.trim().toLowerCase() || "";
    let rows = state.listings.filter(item => !watchOnly || state.watchlist.has(item.id));
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
      analysis.trend.count ? `<span class="flag">${analysis.trend.count} comparable${analysis.trend.count === 1 ? "" : "s"}</span>` : '<span class="flag">Needs comparables</span>',
      analysis.risk.score >= 20 ? `<span class="flag warn">Risk ${analysis.risk.score}</span>` : "",
      `<span class="flag">${escapeHtml(analysis.category)}</span>`
    ].join("");
    return `
      <article class="listing-card" data-id="${escapeHtml(item.id)}">
        <div class="listing-top">
          ${item.image ? `<img class="listing-image" src="${escapeHtml(item.image)}" alt="">` : '<div class="listing-image"></div>'}
          <div><div class="listing-title">${escapeHtml(item.title)}</div><div class="listing-meta">${escapeHtml(item.location || analysis.category)}</div><div class="listing-price">${item.priceLabel ? escapeHtml(item.priceLabel) : money(item.price)}</div></div>
          <div class="score-bubble ${scoreClass}" title="Deal score">${analysis.placeholder.value ? "?" : analysis.score}</div>
        </div>
        <div class="flag-row">${flags}</div>
        <div class="card-actions">
          <button data-action="details">Details</button>
          <button data-action="similar">Find similar</button>
          <button data-action="watch">${state.watchlist.has(item.id) ? "Unsave" : "Watch"}</button>
        </div>
      </article>`;
  }

  function render() {
    const rows = filteredListings(false);
    $("#listingList").innerHTML = rows.map(card).join("");
    $("#emptyState").style.display = rows.length ? "none" : "block";
    const watches = filteredListings(true);
    $("#watchlistList").innerHTML = watches.map(card).join("");
    $("#watchEmpty").style.display = watches.length ? "none" : "block";
    $("#totalCount").textContent = state.listings.length;
    $("#dealCount").textContent = state.listings.filter(item => item.analysis?.score >= state.settings.minimumScore).length;
    $("#riskCount").textContent = state.listings.filter(item => item.analysis?.placeholder.value || item.analysis?.risk.score >= 20).length;
    $("#scanHeadline").textContent = state.listings.length ? `${state.listings.length} listings in your local history` : "Ready to inspect listings";
    $("#scanDetail").textContent = state.listings.length ? "Scores improve as you scan more similar items." : "Open Marketplace results, then scan what is loaded.";
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
      });
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

  function showDetails(item) {
    const a = item.analysis;
    const specs = Object.entries(a.specs || {}).map(([key, value]) => `<span class="flag">${escapeHtml(key)}: ${escapeHtml(value)}</span>`).join("") || '<span class="flag">No specifications detected</span>';
    $("#detailContent").innerHTML = `
      <div class="detail-score"><div class="score-bubble ${a.score >= 75 ? "" : a.score >= 55 ? "mid" : "low"}">${a.placeholder.value ? "?" : a.score}</div><div><h3>${escapeHtml(item.title)}</h3><p class="listing-meta">${escapeHtml(a.category)} · ${item.priceLabel ? escapeHtml(item.priceLabel) : money(item.price)}</p></div></div>
      <div class="metric-row"><div><strong>${money(a.trend.median)}</strong><span>Comparable median</span></div><div><strong>${money(a.expectedProfit)}</strong><span>Est. gross profit</span></div><div><strong>${a.trend.count}</strong><span>Comparables</span></div></div>
      <div class="detail-section"><h4>Why this score</h4><ul>${a.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></div>
      <div class="detail-section"><h4>Detected specifications</h4><div class="flag-row">${specs}</div></div>
      <div class="detail-section"><h4>Comparable asking-price range</h4><p>${a.trend.count ? `${money(a.trend.low)} – ${money(a.trend.high)} from ${a.trend.count} locally scanned similar listings.` : "Scan a similar-item search to build a local price range."}</p></div>
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
    $("#saveEstimate").addEventListener("click", () => saveListingFields(item, {
      manualReferencePrice: Number($("#referencePrice").value) || null,
      repairCost: Number($("#repairCost").value) || 0,
      transportCost: Number($("#transportCost").value) || 0
    }, "Estimate saved"));
    $("#saveOutcome").addEventListener("click", () => saveListingFields(item, {
      actualPurchasePrice: Number($("#actualPurchase").value) || null,
      actualResalePrice: Number($("#actualResale").value) || null
    }, "Outcome saved"));
    $("#detailDialog").showModal();
  }

  async function saveListingFields(item, fields, confirmation) {
    Object.assign(item, fields);
    const stored = await chrome.storage.local.get(["dealLensListings"]);
    const listings = stored.dealLensListings || {};
    listings[item.id] = { ...(listings[item.id] || {}), ...item, ...fields };
    await chrome.storage.local.set({ dealLensListings: listings });
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
    state.watchlist.has(id) ? state.watchlist.delete(id) : state.watchlist.add(id);
    await chrome.storage.local.set({ dealLensWatchlist: [...state.watchlist] });
    render();
  }

  async function scanActiveTab() {
    const button = $("#scanButton");
    button.disabled = true;
    button.textContent = "Scanning…";
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.includes("facebook.com/marketplace")) throw new Error("Open a Facebook Marketplace page first.");
      const response = await chrome.tabs.sendMessage(tab.id, { type: "DEALLENS_SCAN" });
      await new Promise(resolve => setTimeout(resolve, 350));
      await loadState();
      showToast(response?.found ? `Captured ${response.found} listing${response.found === 1 ? "" : "s"}` : "No new listing cards found");
    } catch (error) {
      showToast(error.message || "Could not scan this page");
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
    await chrome.storage.local.remove(["dealLensListings", "dealLensWatchlist"]);
    await loadState();
    showToast("Local listing data cleared");
  });
  chrome.runtime.onMessage.addListener(message => { if (message?.type === "DEALLENS_UPDATED") loadState(); });
  loadState();
})();
