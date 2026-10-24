// The processing-mode probe check-next-artifact.sh runs in the page (fm-x6h5): finds the select by its accessible
// name, opens an enclosing closed <details> only if there is one, and reports the route values and where the
// select lives. No class name is assumed (the candidate kept it in `.next-advanced`; the port need not).
globalThis.__probeProvider = () => {
  const named = [...document.querySelectorAll('select')].filter((s) => {
    const label =
      s.getAttribute('aria-label') || (s.labels && s.labels[0] && s.labels[0].textContent) || '';
    return label.trim() === 'Processing mode';
  });
  if (named.length !== 1) return { found: named.length, routes: [], providerLocation: null };
  const select = named[0];
  const details = select.closest('details');
  const opened = !!details && !details.open;
  if (opened) details.open = true;
  const region = select.closest('details, dialog, header, footer, nav, aside, main, section, form');
  return {
    found: 1,
    routes: [...select.options].map((o) => o.value),
    providerLocation: {
      region: region ? region.tagName.toLowerCase() : 'body',
      inClosedDetails: opened,
      classes: region ? [...region.classList].sort() : [],
    },
  };
};
