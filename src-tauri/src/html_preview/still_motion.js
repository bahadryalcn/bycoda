// Still frame: report prefers-reduced-motion so a scene renders one frame and stops.
(() => {
  const original = window.matchMedia.bind(window);
  const REDUCE = /^\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*$/i;
  window.matchMedia = (query) => {
    const text = String(query);
    if (!REDUCE.test(text)) return original(query);
    const noop = () => {};
    return {
      matches: true,
      media: text,
      onchange: null,
      addEventListener: noop,
      removeEventListener: noop,
      addListener: noop,
      removeListener: noop,
      dispatchEvent: () => false,
    };
  };
})();
