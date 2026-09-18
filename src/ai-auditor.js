(function initDealLensAI(root) {
  "use strict";

  const RESPONSE_SCHEMA = {
    type: "object",
    properties: {
      summary: { type: "string" },
      detectedSpecs: { type: "array", items: { type: "string" } },
      defects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            evidence: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            repairCategory: { type: "string" }
          },
          required: ["label", "evidence", "confidence", "repairCategory"],
          additionalProperties: false
        }
      },
      contradictions: { type: "array", items: { type: "string" } },
      liquidityTier: { type: "string", enum: ["high", "medium", "low", "unknown"] },
      liquidityReason: { type: "string" },
      sellerQuestions: { type: "array", items: { type: "string" } },
      confidence: { type: "number", minimum: 0, maximum: 1 }
    },
    required: ["summary", "detectedSpecs", "defects", "contradictions", "liquidityTier", "liquidityReason", "sellerQuestions", "confidence"],
    additionalProperties: false
  };

  const SESSION_OPTIONS = {
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }]
  };

  function compactText(value, limit = 2200) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function buildPrompt(listing) {
    const payload = {
      title: compactText(listing.title, 240),
      displayedPricePhp: Number(listing.price) || null,
      description: compactText(listing.text),
      category: compactText(listing.category, 80),
      ruleDetectedSpecs: listing.specs || {}
    };
    return `Audit this Marketplace electronics listing using only the supplied text.\n\n${JSON.stringify(payload)}\n\nRules:\n- Do not invent a defect, specification, repair price, seller fact, or resale price.\n- A defect must include a short exact phrase from the listing as evidence.\n- If wording is Filipino, Taglish, ambiguous, or unsupported, lower confidence and say what needs confirmation.\n- repairCategory is only a general label such as battery, display, keyboard, storage, motherboard, or none; never provide a peso amount.\n- Liquidity is an advisory classification, not a price adjustment.\n- Questions should verify the most financially important unknowns.\n- Keep the summary under 70 words.`;
  }

  function strings(value, limit = 8) {
    return Array.isArray(value) ? value.filter(item => typeof item === "string").map(item => compactText(item, 300)).filter(Boolean).slice(0, limit) : [];
  }

  function number01(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
  }

  function normalizeAudit(value) {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") throw new Error("The local model returned an invalid audit.");
    const allowedTiers = new Set(["high", "medium", "low", "unknown"]);
    return {
      summary: compactText(parsed.summary, 800) || "No reliable summary was produced.",
      detectedSpecs: strings(parsed.detectedSpecs, 12),
      defects: Array.isArray(parsed.defects) ? parsed.defects.slice(0, 8).map(defect => ({
        label: compactText(defect?.label, 120),
        evidence: compactText(defect?.evidence, 300),
        confidence: number01(defect?.confidence),
        repairCategory: compactText(defect?.repairCategory, 80) || "none"
      })).filter(defect => defect.label && defect.evidence) : [],
      contradictions: strings(parsed.contradictions, 8),
      liquidityTier: allowedTiers.has(parsed.liquidityTier) ? parsed.liquidityTier : "unknown",
      liquidityReason: compactText(parsed.liquidityReason, 500),
      sellerQuestions: strings(parsed.sellerQuestions, 8),
      confidence: number01(parsed.confidence),
      engine: "Chrome built-in AI",
      auditedAt: new Date().toISOString()
    };
  }

  async function availability() {
    if (typeof root.LanguageModel === "undefined") return "unsupported";
    try {
      return await root.LanguageModel.availability(SESSION_OPTIONS);
    } catch {
      return "unsupported";
    }
  }

  async function auditListing(listing, callbacks = {}) {
    if (typeof root.LanguageModel === "undefined") {
      throw new Error("Chrome built-in AI is not available on this browser or device.");
    }
    const status = await root.LanguageModel.availability(SESSION_OPTIONS);
    if (status === "unavailable") throw new Error("This device does not meet Chrome's local AI requirements.");
    callbacks.onStatus?.(status);
    let session;
    try {
      session = await root.LanguageModel.create({
        ...SESSION_OPTIONS,
        initialPrompts: [{
          role: "system",
          content: "You are DealLens Auditor. Analyze only supplied listing text. Be conservative, cite evidence, admit uncertainty, and never invent financial figures."
        }],
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", event => callbacks.onProgress?.(Math.round(event.loaded * 100)));
        }
      });
      callbacks.onStatus?.("auditing");
      const result = await session.prompt(buildPrompt(listing), {
        responseConstraint: RESPONSE_SCHEMA,
        omitResponseConstraintInput: true
      });
      return normalizeAudit(result);
    } finally {
      session?.destroy();
    }
  }

  const api = { RESPONSE_SCHEMA, buildPrompt, normalizeAudit, availability, auditListing };
  root.DealLensAI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
