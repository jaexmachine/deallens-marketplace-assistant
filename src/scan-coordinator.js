(function initDealLensScanCoordinator(root) {
  "use strict";

  function createSingleFlight(task) {
    let active = null;
    return function runSingleFlight(...args) {
      if (!active) {
        active = Promise.resolve()
          .then(() => task(...args))
          .finally(() => { active = null; });
      }
      return active;
    };
  }

  function withTimeout(promise, milliseconds, message = "Operation timed out") {
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function marketplacePageKey(value) {
    try {
      const url = new URL(value);
      const item = url.pathname.match(/\/marketplace\/item\/(\d+)/);
      if (item) return `/marketplace/item/${item[1]}`;
      const meaningful = ["query", "category_id", "minPrice", "maxPrice", "sortBy", "daysSinceListed"];
      const params = new URLSearchParams();
      meaningful.forEach(key => {
        if (url.searchParams.has(key)) params.set(key, url.searchParams.get(key));
      });
      return `${url.pathname}${params.size ? `?${params}` : ""}`;
    } catch {
      return String(value || "").split("#")[0];
    }
  }

  function isContextInvalidated(error) {
    return /extension context invalidated/i.test(String(error?.message || error || ""));
  }

  function isDealLensNode(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(element?.matches?.("#deallens-scan-control, .deallens-badge") || element?.closest?.("#deallens-scan-control, .deallens-badge"));
  }

  function hasMarketplaceMutation(mutations) {
    return mutations.some(mutation => {
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return changedNodes.some(node => !isDealLensNode(node));
    });
  }

  const api = { createSingleFlight, withTimeout, marketplacePageKey, isContextInvalidated, isDealLensNode, hasMarketplaceMutation };
  root.DealLensScan = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
