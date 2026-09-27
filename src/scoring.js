(function initDealLensScoring(root) {
  "use strict";

  const PLACEHOLDER_PRICES = new Set([0, 1, 12, 99, 100, 123, 1234]);
  const PRICE_TERMS = [
    /\b(?:pm|message|inbox|dm)\s+(?:me\s+)?(?:for\s+)?(?:the\s+)?price\b/i,
    /\bprice\s+(?:is\s+)?(?:negotiable|varies|depends)\b/i,
    /\b(?:monthly|per\s+month|installment|down\s*payment|deposit|dp\s*only)\b/i,
    /\b(?:starts?|starting)\s+(?:at|from)\b/i
  ];
  const RISK_RULES = [
    { re: /\b(?:deposit|down\s*payment|reservation\s*fee)\b/i, points: 16, label: "Requests an advance payment" },
    { re: /\b(?:rush|urgent|today\s+only|first\s+to\s+pay)\b/i, points: 10, label: "Uses urgency language" },
    { re: /\b(?:telegram|whatsapp|viber)\b/i, points: 8, label: "Moves the conversation off-platform" },
    { re: /https?:\/\/(?!www\.facebook\.com)/i, points: 12, label: "Contains an external link" },
    { re: /\b(?:no\s+meetup|shipping\s+only|payment\s+first)\b/i, points: 20, label: "Avoids inspection or requires payment first" },
    { re: /\b(?:sealed|brand\s+new)\b/i, points: 3, label: "High-value condition claim should be verified" }
  ];
  const MIN_COMPARABLES = 3;
  const REPAIR_COST_RANGES = {
    battery: { label: "Laptop battery", low: 1200, high: 1800, suggested: 1400 },
    keyboard: { label: "Keyboard / top case", low: 1200, high: 2200, suggested: 1500 },
    display: { label: "Laptop display panel", low: 2500, high: 4500, suggested: 3000 },
    hinge: { label: "Hinge / shell repair", low: 1800, high: 3200, suggested: 2200 },
    iphoneCamera: { label: "iPhone camera module", low: 3200, high: 4500, suggested: 3800 },
    iphoneScreen: { label: "iPhone screen", low: 2200, high: 4500, suggested: 2500 },
    laptopCharger: { label: "Laptop charger", low: 600, high: 1200, suggested: 800 },
    digicamPower: { label: "Digicam battery / charger", low: 400, high: 900, suggested: 600 }
  };
  const FATAL_DEFECT_RULES = [
    { re: /\b(code\s*43|error\s*43)\b/i, label: "GPU or device Code 43 is disclosed" },
    { re: /\b(driver\s*issue\s*(?:sa\s*)?(?:gpu|graphics)|di\s*ma-?detect\s*(?:ang\s*)?(?:dedicated|gpu))\b/i, label: "Dedicated graphics may not be detected" },
    { re: /\b(nakalimutan\s*(?:ang\s*)?(?:apple\s*id|icloud)|need\s*(?:ipa-?)?bypass|icloud\s*(?:lock|issue|pass)|activation\s*lock|locked\s*to\s*owner|hello\s*screen)\b/i, label: "Activation or ownership lock is disclosed" },
    { re: /\b(no\s+power|dead\s+board|motherboard\s+(?:issue|dead)|board\s+issue)\b/i, label: "Possible board-level or no-power failure" }
  ];
  const EVASION_RULES = [
    /\bkayo\s+na\s+magpaayos\b/i, /\bpapaayos\s+lang\b/i, /\bsimpleng\s+repair\s+lang\b/i,
    /\bminsan\s+lang\s+naman\b/i, /\bfor\s+tech(?:nician)?\s+only\b/i, /\bbawal\s+sa\s+maarte\b/i
  ];
  const CONDITION_NEGATIVE = [
    { re: /\b(?:not\s+working|does(?:n'?t|\s+not)\s+work|won'?t\s+(?:turn\s+on|boot)|no\s+power|for\s+parts|parts\s+only|broken|defective|dead\s+unit)\b/i, delta: -30, label: "Seller describes a non-working or parts-only item" },
    { re: /\b(?:may\s+issue|with\s+issue|has\s+(?:an?\s+)?issue|issue\s+(?:sa|with)|damaged?|crack(?:ed)?|dented|missing|needs?\s+repair|repaired|replacement)\b/i, delta: -16, label: "Possible defect, repair, or missing component" },
    { re: /\b(?:hindi|di|ayaw)\s+(?:gumagana|mag\s*on|bumukas)|\b(?:sira|basag|may\s+lines?|needs?\s+battery)\b/i, delta: -24, label: "Possible defect described in Filipino or Taglish" }
  ];
  const CONDITION_POSITIVE = [
    { re: /\b(?:no\s+issues?|without\s+issues?|fully\s+working|tested\s+and\s+working|works?\s+properly|good\s+condition)\b/i, delta: 9, label: "Seller claims working condition" },
    { re: /\b(?:walang\s+issue|maayos|gumagana\s+nang\s+maayos)\b/i, delta: 9, label: "Seller claims working condition in Filipino or Taglish" },
    { re: /\b(?:like\s+new|brand\s+new|unused)\b/i, delta: 11, label: "Seller claims excellent condition" }
  ];
  const STOP_WORDS = new Set(["the", "and", "with", "for", "sale", "selling", "used", "good", "condition", "like", "new", "unit", "only", "rush", "price", "negotiable", "php"]);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeMinimumScore(value, fallback = 5.5) {
    let score = Number(value);
    if (!Number.isFinite(score)) score = fallback;
    if (score > 10) score /= 10;
    return Math.round(clamp(score, 1, 10) * 10) / 10;
  }

  function median(values) {
    const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!nums.length) return null;
    const middle = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[middle] : (nums[middle - 1] + nums[middle]) / 2;
  }

  function percentile(values, p) {
    const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!nums.length) return null;
    const index = (nums.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return nums[lower];
    return nums[lower] + (nums[upper] - nums[lower]) * (index - lower);
  }

  function weightedMedian(items) {
    const rows = (items || []).filter(item => Number.isFinite(item.value) && Number(item.weight) > 0).sort((a, b) => a.value - b.value);
    if (!rows.length) return null;
    const total = rows.reduce((sum, item) => sum + Number(item.weight), 0);
    let cumulative = 0;
    for (const item of rows) {
      cumulative += Number(item.weight);
      if (cumulative >= total / 2) return item.value;
    }
    return rows[rows.length - 1].value;
  }

  function removePriceOutliers(items) {
    if ((items || []).length < 3) return [...(items || [])];
    const center = median(items.map(item => item.price));
    const deviations = items.map(item => Math.abs(item.price - center));
    const mad = median(deviations);
    return items.filter(item => {
      const ratioOk = item.price >= center * 0.5 && item.price <= center * 2;
      const deviationOk = !mad || Math.abs(item.price - center) <= mad * 3;
      return ratioOk && deviationOk;
    });
  }

  function parsePrice(value) {
    if (Number.isFinite(value)) return value;
    const text = String(value || "").replace(/,/g, "");
    const match = text.match(/(?:₱|PHP\s*)?\s*(\d+(?:\.\d+)?)(?:\s*([kKmM]))?/);
    if (!match) return null;
    let amount = Number(match[1]);
    if (match[2]?.toLowerCase() === "k") amount *= 1000;
    if (match[2]?.toLowerCase() === "m") amount *= 1000000;
    return Number.isFinite(amount) ? Math.round(amount) : null;
  }

  function extractSpecs(textValue) {
    const text = String(textValue || "");
    const specs = {};
    const ram = text.match(/\b(4|6|8|12|16|24|32|48|64|128)\s*GB\s*(?:RAM|memory)\b/i)
      || text.match(/\b(?:RAM|memory)\s*[:\-]?\s*(4|6|8|12|16|24|32|48|64|128)\s*GB\b/i);
    const storage = text.match(/\b(64|128|240|250|256|480|500|512|1000|1024|2000|2048)\s*(GB|TB)\s*(SSD|HDD|storage)?\b/i);
    const intel = text.match(/\b(?:intel\s+)?(i[3579][\s-]?\d{3,5}[a-z]{0,2}\d?)\b/i);
    const ryzen = text.match(/\b(?:AMD\s+)?(Ryzen\s*[3579]\s*\d{4}[a-z]{0,2})\b/i);
    const gpu = text.match(/\b((?:RTX|GTX|RX)\s*\d{3,4}(?:\s*Ti|\s*Super)?|Arc\s+A\d{3})\b/i);
    const iphone = text.match(/\b(iPhone\s+(?:SE|X[RS]?|1[1-9])(?:\s+(?:Pro(?:\s+Max)?|Plus|Mini))?)\b/i);
    const galaxy = text.match(/\b(Galaxy\s+(?:S|A|Z|Note)\s?\d{1,2}(?:\s+(?:Ultra|Plus|FE))?)\b/i);
    if (ram) specs.ramGb = Number(ram[1]);
    if (storage) specs.storageGb = Number(storage[1]) * (storage[2].toUpperCase() === "TB" ? 1024 : 1);
    if (intel) specs.cpu = intel[1].replace(/\s+/g, "-").toUpperCase();
    if (ryzen) specs.cpu = ryzen[1].replace(/\s+/g, " ");
    if (gpu) specs.gpu = gpu[1].replace(/\s+/g, " ").toUpperCase();
    if (iphone) specs.model = iphone[1].replace(/\s+/g, " ");
    if (galaxy) specs.model = galaxy[1].replace(/\s+/g, " ");
    return specs;
  }

  function classifyCategory(textValue) {
    const text = String(textValue || "").toLowerCase();
    if (/\b(?:laptop|notebook|macbook|thinkpad|chromebook)\b/.test(text)) return "Laptop";
    if (/\b(?:iphone|android|smartphone|cellphone|galaxy|pixel|xiaomi|redmi|oppo|vivo)\b/.test(text)) return "Phone";
    if (/\b(?:playstation|ps[345]|xbox|nintendo|switch|console)\b/.test(text)) return "Console";
    if (/\b(?:camera|dslr|mirrorless|canon|nikon|fujifilm|sony\s+a\d)\b/.test(text)) return "Camera";
    if (/\b(?:rtx|gtx|graphics\s+card|gpu|processor|motherboard|ram\b|ssd\b)\b/.test(text)) return "PC Part";
    if (/\b(?:tablet|ipad)\b/.test(text)) return "Tablet";
    return "Electronics";
  }

  function titleTokens(textValue) {
    return String(textValue || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(token => token.length > 1 && !STOP_WORDS.has(token));
  }

  function similarity(a, b) {
    const aTokens = new Set(titleTokens(a.title || a.text));
    const bTokens = new Set(titleTokens(b.title || b.text));
    if (!aTokens.size || !bTokens.size) return 0;
    let intersection = 0;
    aTokens.forEach(token => { if (bTokens.has(token)) intersection += 1; });
    const union = new Set([...aTokens, ...bTokens]).size;
    let score = intersection / union;
    const aSpecs = a.specs || extractSpecs(`${a.title || ""} ${a.text || ""}`);
    const bSpecs = b.specs || extractSpecs(`${b.title || ""} ${b.text || ""}`);
    ["model", "cpu", "gpu", "ramGb", "storageGb"].forEach(key => {
      if (aSpecs[key] && bSpecs[key] && String(aSpecs[key]).toLowerCase() === String(bSpecs[key]).toLowerCase()) score += 0.12;
    });
    if (classifyCategory(a.title || a.text) !== classifyCategory(b.title || b.text)) score -= 0.25;
    return clamp(score, 0, 1);
  }

  function specsCompatible(listing, candidate) {
    const a = listing.specs || extractSpecs(`${listing.title || ""} ${listing.text || ""}`);
    const b = candidate.specs || extractSpecs(`${candidate.title || ""} ${candidate.text || ""}`);
    if (a.model && b.model && String(a.model).toLowerCase() !== String(b.model).toLowerCase()) return false;
    if (a.gpu && b.gpu && String(a.gpu).toLowerCase() !== String(b.gpu).toLowerCase()) return false;
    if (a.cpu && b.cpu && String(a.cpu).toLowerCase() !== String(b.cpu).toLowerCase()) return false;
    return true;
  }

  function findComparables(listing, listings, threshold = 0.4) {
    return (listings || [])
      .filter(candidate => candidate.id !== listing.id && Number.isFinite(candidate.price) && candidate.price > 1234)
      .filter(candidate => classifyCategory(candidate.title || candidate.text) === classifyCategory(listing.title || listing.text))
      .filter(candidate => specsCompatible(listing, candidate))
      .map(candidate => ({ ...candidate, similarity: similarity(listing, candidate) }))
      .filter(candidate => candidate.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 20);
  }

  function preferenceSignals(listing) {
    const text = `${listing.title || ""} ${listing.text || ""}`;
    const specs = listing.specs || extractSpecs(text);
    const signals = titleTokens(listing.title || text).slice(0, 8).map(token => `token:${token}`);
    signals.push(`category:${classifyCategory(text).toLowerCase()}`);
    ["model", "cpu", "gpu"].forEach(key => {
      if (specs[key]) signals.push(`${key}:${String(specs[key]).toLowerCase()}`);
    });
    if (specs.ramGb) signals.push(`ram:${specs.ramGb}`);
    if (specs.storageGb) signals.push(`storage:${specs.storageGb}`);
    if (Number(listing.price) > 0) signals.push(`priceBand:${Math.floor(Number(listing.price) / 10000) * 10000}`);
    return [...new Set(signals)];
  }

  function personalizationFor(listing, preferenceModel = {}) {
    const weights = preferenceModel.weights || {};
    const signals = preferenceSignals(listing);
    const weighted = signals.reduce((sum, signal) => sum + (Number(weights[signal]) || 0), 0);
    const confidence = Math.min(1, (Number(preferenceModel.feedbackCount) || 0) / 8);
    const adjustment = Math.round(clamp((weighted / Math.max(1, Math.sqrt(signals.length))) * (0.55 + confidence * 0.45) * 3, -18, 18));
    return { adjustment, signals, confidence };
  }

  function trendFor(listing, listings) {
    const candidates = findComparables(listing, listings);
    const comparables = removePriceOutliers(candidates);
    const prices = comparables.map(item => item.price);
    const sufficient = comparables.length >= MIN_COMPARABLES;
    const robustMedian = sufficient ? weightedMedian(comparables.map(item => ({ value: item.price, weight: Math.max(0.1, item.similarity) }))) : null;
    return {
      count: prices.length,
      rawCount: candidates.length,
      rejectedCount: candidates.length - comparables.length,
      sufficient,
      median: robustMedian,
      low: sufficient ? percentile(prices, 0.25) : null,
      high: sufficient ? percentile(prices, 0.75) : null,
      quality: comparables.length >= 8 ? "high" : comparables.length >= 5 ? "medium" : sufficient ? "limited" : "insufficient",
      comparableIds: comparables.map(item => item.id)
    };
  }

  function isPlaceholderPrice(listing, trend) {
    const text = `${listing.title || ""} ${listing.text || ""}`;
    const exact = PLACEHOLDER_PRICES.has(listing.price);
    const language = PRICE_TERMS.some(re => re.test(text));
    const extreme = Boolean(trend?.median && listing.price > 0 && listing.price < trend.median * 0.12);
    return { value: exact || language || extreme, exact, language, extreme };
  }

  function analyzeRisk(listing, placeholder) {
    const text = `${listing.title || ""} ${listing.text || ""}`;
    const reasons = [];
    let score = 0;
    RISK_RULES.forEach(rule => {
      if (rule.re.test(text)) {
        score += rule.points;
        reasons.push(rule.label);
      }
    });
    if (placeholder.value) {
      score += placeholder.extreme ? 18 : 10;
      reasons.push("Displayed price may not be the actual cash price");
    }
    if (text.trim().length < 40) {
      score += 8;
      reasons.push("Listing provides very little detail");
    }
    return { score: clamp(score, 0, 100), reasons };
  }

  function analyzeCondition(listing) {
    const text = `${listing.title || ""} ${listing.text || ""}`;
    let score = 55;
    const reasons = [];
    const negativeMatches = CONDITION_NEGATIVE.filter(rule => rule.re.test(text));
    const positiveMatches = CONDITION_POSITIVE.filter(rule => rule.re.test(text));
    negativeMatches.forEach(rule => {
      score += rule.delta;
      reasons.push(rule.label);
    });
    if (negativeMatches.length && positiveMatches.length) {
      reasons.push("Condition wording is contradictory; verify the item in person");
    } else positiveMatches.forEach(rule => {
      if (rule.re.test(text)) {
        score += rule.delta;
        reasons.push(rule.label);
      }
    });
    const finalScore = clamp(score, 0, 100);
    const label = finalScore >= 75 ? "Excellent claim" : finalScore >= 55 ? "Usable / unknown" : finalScore >= 35 ? "Needs inspection" : "Likely repair project";
    return {
      score: finalScore,
      label,
      reasons: reasons.length ? [...new Set(reasons)] : ["Condition is not described clearly; verify it in person"],
      contradictory: negativeMatches.length > 0 && positiveMatches.length > 0
    };
  }

  function extractDescriptionPrices(listing) {
    const text = String(listing.text || "");
    const displayed = Number(listing.price) || 0;
    const values = [];
    const pattern = /(?:₱|PHP\s*|\bP\s*)(\d{1,3}(?:,\d{3})+|\d{3,6})(?:\.\d+)?|\b(\d+(?:\.\d+)?)\s*k\b/gi;
    let match;
    while ((match = pattern.exec(text))) {
      const value = match[2] ? Number(match[2]) * 1000 : Number(String(match[1]).replace(/,/g, ""));
      if (Number.isFinite(value) && value >= 500 && value <= 5000000) values.push(Math.round(value));
    }
    return [...new Set(values)].filter(value => value !== displayed);
  }

  function priceBaitFor(listing) {
    const displayedPrice = Number(listing.price) || 0;
    const descriptionPrices = extractDescriptionPrices(listing);
    const higher = descriptionPrices.filter(value => value > displayedPrice * 1.05).sort((a, b) => b - a)[0] || null;
    return {
      detected: Boolean(displayedPrice && higher),
      displayedPrice,
      descriptionPrice: higher,
      effectivePrice: higher || displayedPrice,
      evidence: higher ? `Description mentions ₱${higher.toLocaleString("en-PH")}, above the displayed price` : ""
    };
  }

  function repairSignalsFor(listing) {
    const text = `${listing.title || ""} ${listing.text || ""}`;
    const definitions = [
      ["battery", /\b(needs?\s+(?:a\s+)?battery|dead\s+battery|battery\s+(?:dead|issue)|plug\s+and\s+play)\b/i],
      ["keyboard", /\b(?:ghost\s*typing|phantom\s+keys?|dead\s+keys?|some\s+keys?\s+(?:not\s+working|ayaw)|keyboard\s+issue)\b/i],
      ["display", /\b(?:may\s+lines?\s*(?:sa\s*)?(?:screen|lcd)?|screen\s+lines?|cracked\s+(?:screen|lcd)|flickering\s+(?:display|screen)|white\s+spots?)\b/i],
      ["hinge", /\b(?:broken\s+hinge|hinge\s+(?:issue|broken)|bako\s+ang\s+casing)\b/i],
      ["iphoneCamera", /\b(?:camera\s+(?:issue|broken)|ois\s+rattle|0\.5x\s+(?:dead|not\s+working))\b/i],
      ["iphoneScreen", /\b(?:iphone\s+)?(?:third[- ]party|replacement|broken)\s+(?:screen|lcd|display)\b/i],
      ["laptopCharger", /\b(?:no|missing|without)\s+(?:original\s+)?charger\b/i],
      ["digicamPower", /\b(?:camera|digicam).{0,30}(?:no|missing|without)\s+(?:battery|charger)\b/i]
    ];
    return definitions.filter(([, re]) => re.test(text)).map(([category, re]) => {
      const range = REPAIR_COST_RANGES[category];
      return { category, ...range, evidence: text.match(re)?.[0] || range.label };
    });
  }

  function fatalFlagsFor(listing) {
    const text = `${listing.title || ""} ${listing.text || ""}`;
    return FATAL_DEFECT_RULES.filter(rule => rule.re.test(text)).map(rule => rule.label);
  }

  function categoryAuditFor(listing, specs) {
    const text = `${listing.title || ""} ${listing.text || ""}`;
    const notes = [];
    let penalty = 0;
    if (/\b(?:ubuntu|linux|chrome\s*os|cloudready|mrchromebox)\b/i.test(text)) notes.push("Non-standard OS disclosed; verify Windows/macOS licensing and buyer demand");
    const cpu = String(specs.cpu || "").toUpperCase();
    const intel = cpu.match(/I[3579]-?(\d{4,5})/);
    if (intel) {
      const digits = intel[1];
      const generation = digits.length === 5 ? Number(digits.slice(0, 2)) : Number(digits[0]);
      if (generation > 0 && generation < 8) { notes.push(`Legacy Intel ${generation}th-generation platform; verify resale demand`); penalty -= 10; }
      else if (generation >= 8) notes.push(`Intel ${generation}th-generation platform meets the basic productivity floor`);
    }
    const ryzen = cpu.match(/RYZEN\s*[3579]\s*(\d{4})/);
    if (ryzen && Number(ryzen[1]) < 3000) { notes.push("Pre-Ryzen-3000 platform; verify performance and demand"); penalty -= 8; }
    const iphone = text.match(/\biPhone\s+(11|12|13|14|15|16|17)\b/i);
    const bh = text.match(/\b(?:battery\s*health|BH)\s*[:\-]?\s*(\d{2,3})\s*%/i)
      || text.match(/\b(\d{2,3})\s*%\s*(?:battery\s*health|BH)\b/i);
    const modelYears = { 11: 2019, 12: 2020, 13: 2021, 14: 2022, 15: 2023, 16: 2024, 17: 2025 };
    if (iphone && bh && 2026 - modelYears[iphone[1]] > 4 && Number(bh[1]) >= 95) notes.push("Unusually high battery health for this model age; verify replacement history and battery authenticity");
    if (/\b(?:digicam|digital\s+camera|powershot|cyber-?shot|coolpix|exilim)\b/i.test(text)) {
      const packageItems = [/[\b\s](?:original\s+)?charger\b/i.test(` ${text}`) && "charger", /\bworking\s+battery\b/i.test(text) && "battery", /\bSD\s*card\b/i.test(text) && "SD card"].filter(Boolean);
      if (packageItems.length) notes.push(`Digicam package mentions ${packageItems.join(", ")}; verify each item at meetup`);
      if (/\b(?:pink|baby\s+blue|lilac|white)\b/i.test(text)) notes.push("Potential colorway premium is advisory only until supported by comparable prices");
    }
    return { notes, penalty };
  }

  function freshnessFor(listing) {
    const text = `${listing.title || ""} ${listing.text || ""}`;
    let hours = null;
    let match = text.match(/\b(?:listed\s+)?(\d+)\s*(minute|hour|day|week|month)s?\s+ago\b/i);
    if (match) {
      const multipliers = { minute: 1 / 60, hour: 1, day: 24, week: 168, month: 720 };
      hours = Number(match[1]) * multipliers[match[2].toLowerCase()];
    } else if (/\b(?:just\s+now|today)\b/i.test(text)) hours = 12;
    let score = 5;
    let label = "Age unknown";
    if (hours !== null) {
      if (hours <= 24) { score = 10; label = "Fresh lead"; }
      else if (hours <= 72) { score = 8; label = "Active listing"; }
      else if (hours < 24 * 14) { score = 5; label = "Established listing"; }
      else if (hours < 24 * 30) { score = 3; label = "Stale listing"; }
      else { score = 1; label = "Very old listing"; }
    }
    return { score, label, hours };
  }

  function aiAdjustmentFor(audit) {
    if (!audit || typeof audit !== "object") return { adjustment: 0, reasons: [], applied: false };
    const confidence = clamp(Number(audit.confidence) || 0, 0, 1);
    if (confidence < 0.55) return { adjustment: 0, reasons: ["AI audit confidence was too low to change the Deal Score"], applied: true };
    const defectPenalty = (audit.defects || []).reduce((sum, defect) => sum + (Number(defect.confidence) >= 0.65 ? 4 : 2), 0);
    const contradictionPenalty = Math.min(6, (audit.contradictions || []).length * 2);
    const liquidity = audit.liquidityTier === "high" ? 3 : audit.liquidityTier === "low" ? -4 : 0;
    const raw = liquidity - Math.min(14, defectPenalty) - contradictionPenalty;
    const adjustment = Math.round(clamp(raw * (0.45 + confidence * 0.55), -18, 5));
    const reasons = [];
    if (adjustment < 0) reasons.push(`On-device AI audit reduced the score by ${(Math.abs(adjustment) / 10).toFixed(1)} for supported defect or contradiction signals`);
    if (adjustment > 0) reasons.push(`On-device AI audit added ${(adjustment / 10).toFixed(1)} for strong liquidity with no larger text-supported penalty`);
    return { adjustment, reasons, applied: true };
  }

  function completenessFor(listing, specs) {
    const title = String(listing.title || "").trim();
    const text = String(listing.text || "").trim();
    let score = 15;
    if (title.length >= 8) score += 15;
    if (text.length >= 60) score += 15;
    if (text.length >= 140) score += 10;
    if (Number(listing.price) > 0) score += 15;
    score += Math.min(25, Object.keys(specs || {}).length * 5);
    if (listing.location) score += 5;
    return clamp(score, 0, 100);
  }

  function scoreListing(listing, allListings = [], settings = {}, preferenceModel = {}) {
    const trend = trendFor(listing, allListings);
    const placeholder = isPlaceholderPrice(listing, trend);
    const risk = analyzeRisk(listing, placeholder);
    const condition = analyzeCondition(listing);
    const specs = extractSpecs(`${listing.title || ""} ${listing.text || ""}`);
    const completeness = completenessFor(listing, specs);
    const priceBait = priceBaitFor(listing);
    const price = priceBait.effectivePrice;
    const fatalFlags = fatalFlagsFor(listing);
    const evasionDetected = EVASION_RULES.some(rule => rule.test(`${listing.title || ""} ${listing.text || ""}`));
    const repairSignals = repairSignalsFor(listing);
    const confirmedVisual = (listing.visualAudit?.possibleDefects || []).filter(defect => defect.confirmed === true);
    const suggestedRepairReserve = repairSignals.reduce((sum, item) => sum + item.suggested, 0)
      + confirmedVisual.reduce((sum, item) => sum + Math.max(0, Number(item.suggestedCost) || 0), 0);
    const hasItemCosts = [listing.repairCost, listing.transportCost, listing.otherCost].some(value => Number(value) > 0);
    const manualRepairCost = Number(listing.repairCost) || 0;
    const repairReserve = manualRepairCost || suggestedRepairReserve;
    const prepCosts = hasItemCosts
      ? (Number(listing.transportCost) || 0) + (Number(listing.otherCost) || 0)
      : Number(settings.defaultCosts) || 0;
    const costs = repairReserve + prepCosts;
    const manualReference = Number(listing.manualReferencePrice) || null;
    const referenceValue = manualReference || (trend.sufficient ? trend.median : null);
    const referenceSource = manualReference ? "manual" : trend.sufficient ? "comparables" : "none";
    const expectedProfit = referenceValue && price && !placeholder.value ? Math.round(referenceValue - price - costs) : null;
    const totalInvestment = price + costs;
    const margin = expectedProfit !== null && totalInvestment > 0 ? expectedProfit / totalInvestment : null;
    const recommendedMaxBuyPrice = referenceValue && !placeholder.value
      ? Math.max(0, Math.floor((referenceValue * 0.72 - costs) / 100) * 100)
      : null;
    const suggestedOffer = price > 0 && !placeholder.value
      ? Math.max(0, Math.floor(Math.min(price * 0.9, recommendedMaxBuyPrice || price * 0.9) / 100) * 100)
      : null;
    const reasons = [];
    const personalization = personalizationFor(listing, preferenceModel);
    const components = {
      value: null,
      condition: Math.round(condition.score),
      safety: Math.round(100 - risk.score),
      completeness: Math.round(completeness)
    };
    let scoreStatus = "provisional";
    let confidence = Math.round(clamp(15 + completeness * 0.25 + trend.count * 6, 15, 55));

    if (referenceValue && price > 0 && !placeholder.value) {
      const discount = (referenceValue - price - costs) / referenceValue;
      components.value = Math.round(clamp(50 + discount * 125, 0, 100));
      scoreStatus = "valued";
      confidence = manualReference
        ? 65
        : Math.round(clamp(45 + trend.count * 5 + (trend.quality === "high" ? 8 : trend.quality === "medium" ? 4 : 0), 45, 93));
      const referenceLabel = manualReference ? "your manual reference" : "the robust comparable median";
      if (discount >= 0.25) reasons.push(`Asking price is ${Math.round(discount * 100)}% below ${referenceLabel}`);
      else if (discount < 0) reasons.push(`Asking price is ${Math.round(Math.abs(discount) * 100)}% above ${referenceLabel}`);
      else reasons.push(`Asking price is close to ${referenceLabel}`);
    } else {
      reasons.push("Provisional score — scan similar items to unlock price-based valuation");
    }
    let matchScore = 50 + personalization.adjustment * 1.8;
    const keywords = String(settings.keywords || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
    if (keywords.length) {
      const haystack = `${listing.title || ""} ${listing.text || ""}`.toLowerCase();
      if (keywords.some(keyword => haystack.includes(keyword))) {
        matchScore += 14;
      }
    }
    if (Number(settings.maxPrice) > 0 && price > Number(settings.maxPrice)) {
      matchScore -= 24;
    } else if (Number(settings.maxPrice) > 0 && price > 0 && price <= Number(settings.maxPrice)) {
      matchScore += 6;
    }
    matchScore = Math.round(clamp(matchScore, 0, 100));

    const weights = components.value === null
      ? { condition: 0.30, safety: 0.40, completeness: 0.30 }
      : { value: 0.58, condition: 0.16, safety: 0.16, completeness: 0.10 };
    let dealScore = Object.entries(weights).reduce((sum, [key, weight]) => sum + components[key] * weight, 0);
    const categoryAudit = categoryAuditFor(listing, specs);
    dealScore += categoryAudit.penalty;
    const ai = aiAdjustmentFor(listing.localAiAudit);
    dealScore += ai.adjustment;
    ai.reasons.forEach(reason => reasons.push(reason));
    if (components.value === null) dealScore = Math.min(dealScore, 69);
    if (placeholder.value) {
      dealScore = Math.min(dealScore, 49);
      scoreStatus = "unverified";
      confidence = Math.min(confidence, 30);
      reasons.unshift("Price is unverified and may be a placeholder");
    }
    if (priceBait.detected) {
      dealScore = Math.min(dealScore - 18, 45);
      risk.score = clamp(risk.score + 28, 0, 100);
      risk.reasons.unshift("Possible price bait: the description states a higher price");
      reasons.unshift(priceBait.evidence);
    }
    if (evasionDetected) {
      dealScore -= 35;
      risk.score = clamp(risk.score + 30, 0, 100);
      risk.reasons.unshift("Seller downplays or shifts responsibility for a repair");
      reasons.unshift("Repair-downplaying language detected; treat the affected component as failed until tested");
    }
    if (fatalFlags.length) {
      dealScore = Math.min(dealScore, 15);
      risk.score = clamp(risk.score + 45, 0, 100);
      risk.reasons.unshift(...fatalFlags);
      scoreStatus = "hard-pass";
    }
    if (repairReserve) reasons.push(`${manualRepairCost ? "Manual repair cost" : "Suggested repair reserve"}: ₱${repairReserve.toLocaleString("en-PH")}`);
    if (expectedProfit !== null && expectedProfit > 0) reasons.push(`Projected net margin is ₱${expectedProfit.toLocaleString("en-PH")}`);
    risk.reasons.slice(0, 2).forEach(reason => reasons.push(reason));
    const freshness = freshnessFor(listing);
    let recommendation = "Inspect before buying";
    if (fatalFlags.length || dealScore < 35) recommendation = "Hard pass unless priced for parts and ownership is verified";
    else if (dealScore >= 75 && expectedProfit > 0) recommendation = "High potential — inspect and test before buying";
    else if (dealScore >= 55) recommendation = "Potential deal — negotiate after verification";

    return {
      score: Math.round(clamp(dealScore, 10, 100)) / 10,
      scoreStatus,
      confidence,
      components,
      risk,
      condition,
      placeholder,
      trend,
      referenceValue,
      referenceSource,
      costs,
      repairReserve,
      repairReserveSource: manualRepairCost ? "manual" : suggestedRepairReserve ? "suggested-text-or-confirmed-visual" : "none",
      repairSignals,
      prepCosts,
      totalInvestment,
      expectedProfit,
      margin,
      roi: margin === null ? null : margin * 100,
      fairPrice: referenceValue,
      recommendedMaxBuyPrice,
      suggestedOffer,
      scoreEngine: ai.applied ? "hybrid-ai" : "local",
      aiAdjustment: Math.round(ai.adjustment) / 10,
      reasons: [...new Set(reasons)].slice(0, 5),
      category: classifyCategory(`${listing.title || ""} ${listing.text || ""}`),
      specs,
      personalization,
      matchScore: Math.round(matchScore) / 10,
      freshness,
      priceBait,
      fatalFlags,
      evasionDetected,
      categoryAudit,
      recommendation,
      confidenceLabel: confidence >= 80 ? "high" : confidence >= 60 ? "medium" : confidence >= 40 ? "limited" : "low"
    };
  }

  function buildSearchQuery(listing) {
    const specs = listing.specs || extractSpecs(`${listing.title || ""} ${listing.text || ""}`);
    const tokens = titleTokens(listing.title).slice(0, 5);
    [specs.model, specs.cpu, specs.gpu].filter(Boolean).forEach(value => tokens.push(String(value)));
    return [...new Set(tokens)].slice(0, 7).join(" ");
  }

  const api = { MIN_COMPARABLES, REPAIR_COST_RANGES, parsePrice, normalizeMinimumScore, extractSpecs, classifyCategory, similarity, specsCompatible, findComparables, trendFor, removePriceOutliers, weightedMedian, isPlaceholderPrice, analyzeRisk, analyzeCondition, extractDescriptionPrices, priceBaitFor, repairSignalsFor, fatalFlagsFor, categoryAuditFor, freshnessFor, aiAdjustmentFor, completenessFor, scoreListing, buildSearchQuery, preferenceSignals, personalizationFor, median, percentile };
  root.DealLens = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
