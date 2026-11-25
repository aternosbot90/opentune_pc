/**
 * OpenTune Desktop – @m3e/web bootstrap.
 *
 * Registers the Material 3 Expressive web components used by the UI and bridges
 * the legacy `.active` class convention (used throughout renderer.js) to the
 * `selected` state that m3e chips / toggle buttons / navigation items use.
 *
 * Built to ui/m3e.bundle.js with `npm run build:ui` (esbuild, IIFE).
 */
import '@m3e/web/theme';
import '@m3e/web/button';
import '@m3e/web/icon-button';
import '@m3e/web/card';
import '@m3e/web/checkbox';
import '@m3e/web/chips';
import '@m3e/web/dialog';
import '@m3e/web/divider';
import '@m3e/web/form-field';
import '@m3e/web/loading-indicator';
import '@m3e/web/nav-bar';
import '@m3e/web/nav-rail';
import '@m3e/web/carousel';
import '@m3e/web/progress-indicator';
import '@m3e/web/select';
import '@m3e/web/slider';
import '@m3e/web/snackbar';
import '@m3e/web/switch';

// ---------------------------------------------------------------------------
// `.active` <-> `selected` bridge
// ---------------------------------------------------------------------------
const SELECTABLE = 'm3e-filter-chip, m3e-nav-item, m3e-button[toggle]';

function syncSelected(el) {
  const active = el.classList.contains('active');
  if (el.selected !== active) el.selected = active;
}

function sweep(root) {
  if (root.nodeType !== 1) return;
  if (root.matches(SELECTABLE)) syncSelected(root);
  root.querySelectorAll?.(SELECTABLE).forEach(syncSelected);
}

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.type === 'attributes') {
      if (m.target.matches?.(SELECTABLE)) syncSelected(m.target);
    } else {
      m.addedNodes.forEach(sweep);
    }
  }
});

function startBridge() {
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class']
  });
  sweep(document.body);

  // A user click makes m3e toggle `selected` by itself. renderer.js owns the
  // truth through the `.active` class, so snap the component back to it.
  document.body.addEventListener(
    'change',
    (e) => {
      const el = e.target;
      if (el?.matches?.(SELECTABLE)) queueMicrotask(() => syncSelected(el));
    },
    true
  );
}

if (document.body) startBridge();
else document.addEventListener('DOMContentLoaded', startBridge, { once: true });
