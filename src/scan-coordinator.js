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

  const api = { createSingleFlight, withTimeout, isDealLensNode, hasMarketplaceMutation };
  root.DealLensScan = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
