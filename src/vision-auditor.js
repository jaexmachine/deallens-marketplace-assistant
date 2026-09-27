(function initDealBreakerVision(root) {
  "use strict";

  const MODEL = "gemini-2.5-flash";
  const ORIGIN = "https://generativelanguage.googleapis.com/*";
  const CATEGORIES = new Set(["battery", "keyboard", "display", "hinge", "iphoneCamera", "iphoneScreen", "laptopCharger", "digicamPower", "other"]);

  function clean(value, limit = 500) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function parseJson(text) {
    const source = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("The visual auditor did not return valid JSON.");
    return JSON.parse(source.slice(start, end + 1));
  }

  function normalize(raw) {
    const possibleDefects = (raw?.possibleDefects || []).slice(0, 12).map((item, index) => ({
      id: clean(item?.id || `visual-${index + 1}`, 80),
      label: clean(item?.label, 120),
      evidence: clean(item?.evidence, 400),
      confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
      repairCategory: CATEGORIES.has(item?.repairCategory) ? item.repairCategory : "other",
      suggestedCost: Math.max(0, Math.min(100000, Number(item?.suggestedCost) || 0)),
      confirmed: false
    })).filter(item => item.label && item.evidence);
    return {
      summary: clean(raw?.summary || "Visual review completed", 600),
      possibleDefects,
      hardwareFlags: (raw?.hardwareFlags || []).slice(0, 12).map(value => clean(value, 240)).filter(Boolean),
      verifiedText: (raw?.verifiedText || []).slice(0, 12).map(value => clean(value, 240)).filter(Boolean),
      modelHints: (raw?.modelHints || []).slice(0, 8).map(value => clean(value, 160)).filter(Boolean),
      visualConditionScore: Math.max(0, Math.min(100, Number(raw?.visualConditionScore) || 0)),
      auditedAt: new Date().toISOString(),
      model: MODEL
    };
  }

  function promptFor(listing) {
    return `You are a cautious hardware refurbishment inspector. Review the attached seller-selected images for POSSIBLE visible issues only. Never claim certainty from an image. Look for structural trauma near ports, warped seams, tape or glue around hinges/bezels, JIS keyboard layout, display lines or pressure spots, device-manager warnings, aftermarket-looking phone displays, dense stickers, gouges, dents, and model/spec text. Return JSON only with: summary (string), possibleDefects (array of {id,label,evidence,confidence 0-1,repairCategory one of battery|keyboard|display|hinge|iphoneCamera|iphoneScreen|laptopCharger|digicamPower|other,suggestedCost PHP number}), hardwareFlags (string array), verifiedText (string array), modelHints (string array), visualConditionScore (0-100). Use phrases such as "possible" and "appears". If evidence is weak, omit it. Listing context: ${JSON.stringify({ title: listing.title, price: listing.price, text: String(listing.description || listing.text || "").slice(0, 3000) })}`;
  }

  async function ensurePermission() {
    if (await chrome.permissions.contains({ origins: [ORIGIN] })) return true;
    const granted = await chrome.permissions.request({ origins: [ORIGIN] });
    if (!granted) throw new Error("Cloud image-audit permission was not granted.");
  }

  async function audit({ apiKey, listing, images, model = MODEL }) {
    if (!apiKey) throw new Error("Enter a Gemini API key for this session.");
    if (!images?.length) throw new Error("Choose at least one listing photo or screenshot.");
    await ensurePermission();
    const parts = [{ text: promptFor(listing) }, ...images.slice(0, 4).map(image => ({ inlineData: { mimeType: image.mimeType, data: image.data } }))];
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.1, responseMimeType: "application/json" } })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `Visual audit failed (${response.status}).`);
    const output = payload?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
    return normalize(parseJson(output));
  }

  root.DealBreakerVision = { MODEL, ORIGIN, parseJson, normalize, promptFor, ensurePermission, audit };
  if (typeof module !== "undefined" && module.exports) module.exports = root.DealBreakerVision;
})(typeof globalThis !== "undefined" ? globalThis : this);
