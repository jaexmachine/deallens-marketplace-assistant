(function initDealBreakerDescription(root) {
  "use strict";

  const BOUNDARIES = /^(?:Seller information|About (?:this seller|the seller)|Location(?: is approximate)?|Marketplace profile|Meetup preferences|Sponsored|Related searches|You may also like|Report listing|Share listing|Send seller a message|Seller details)$/i;
  const NOISE = /^(?:See more|See less|Show more|Show less|Translate|Rate this translation|Description)$/i;

  function clean(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  }

  function lines(value) {
    return String(value || "").split(/\n+/).map(clean).filter(Boolean);
  }

  function descriptionFromLines(values) {
    const rows = Array.isArray(values) ? values.map(clean).filter(Boolean) : lines(values);
    const heading = rows.findIndex(row => /^Description$/i.test(row));
    if (heading < 0) return "";
    const collected = [];
    for (const row of rows.slice(heading + 1)) {
      if (BOUNDARIES.test(row)) break;
      if (NOISE.test(row)) continue;
      if (!collected.length && /^(?:Listed|Updated)\s+/i.test(row)) continue;
      collected.push(row);
    }
    return clean(collected.join(" ")).slice(0, 6000);
  }

  function jsonLdDescriptions(doc) {
    const values = [];
    doc.querySelectorAll?.('script[type="application/ld+json"]').forEach(script => {
      try {
        const parsed = JSON.parse(script.textContent || "null");
        const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
        while (queue.length) {
          const value = queue.shift();
          if (!value || typeof value !== "object") continue;
          if (typeof value.description === "string") values.push(clean(value.description));
          if (Array.isArray(value["@graph"])) queue.push(...value["@graph"]);
        }
      } catch { /* Ignore unrelated malformed structured data. */ }
    });
    return values;
  }

  function extract(doc) {
    const candidates = [...jsonLdDescriptions(doc)];
    const meta = clean(doc.querySelector?.('meta[property="og:description"]')?.content || "");
    if (meta && !/^Facebook$/i.test(meta)) candidates.push(meta);
    const headings = [...(doc.querySelectorAll?.("h1, h2, h3, h4, span, div") || [])]
      .filter(node => /^Description$/i.test(clean(node.textContent)));
    headings.slice(0, 12).forEach(heading => {
      let node = heading.parentElement;
      for (let depth = 0; depth < 5 && node; depth += 1, node = node.parentElement) {
        const candidate = descriptionFromLines(node.innerText || "");
        if (candidate) candidates.push(candidate);
      }
    });
    const main = doc.querySelector?.('div[role="main"], main');
    if (main) {
      const candidate = descriptionFromLines(main.innerText || "");
      if (candidate) candidates.push(candidate);
    }
    return [...new Set(candidates)]
      .filter(value => value.length >= 8 && value.length <= 6000)
      .sort((a, b) => b.length - a.length)[0] || "";
  }

  function expand(doc) {
    let clicked = 0;
    [...(doc.querySelectorAll?.('div[role="button"], button, [role="button"]') || [])].forEach(button => {
      if (clicked >= 2 || !/^(?:See more|Show more|Tingnan pa|Ipakita pa)$/i.test(clean(button.textContent))) return;
      let parent = button.parentElement;
      let related = false;
      for (let depth = 0; depth < 4 && parent; depth += 1, parent = parent.parentElement) {
        if (/\bDescription\b/i.test(parent.innerText || "")) { related = true; break; }
      }
      if (related) { button.click(); clicked += 1; }
    });
    return clicked;
  }

  root.DealBreakerDescription = { clean, lines, descriptionFromLines, extract, expand };
  if (typeof module !== "undefined" && module.exports) module.exports = root.DealBreakerDescription;
})(typeof globalThis !== "undefined" ? globalThis : this);
