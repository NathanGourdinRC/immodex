// Feuille de style d'Immodex+, partagée par la carte des annonces (injectée dans
// un Shadow DOM, isolée des styles du site) et par le popup. Tenue en chaîne JS
// pour pouvoir l'injecter dans le Shadow DOM sans exposer de fichier aux sites.
(function () {
  'use strict';

  window.__immodexCSS = `
:host, .imx-popup {
  --imx-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --imx-bg: #ffffff;
  --imx-bg-subtle: #f8fafc;
  --imx-bg-muted: #f1f5f9;
  --imx-border: #e2e8f0;
  --imx-border-strong: #cbd5e1;
  --imx-text: #0f172a;
  --imx-text-2: #334155;
  --imx-text-3: #64748b;
  --imx-accent: #1d4ed8;
  --imx-accent-hover: #1e40af;
  --imx-accent-soft: #eff6ff;
  --imx-accent-line: #bfdbfe;
  --imx-accent-text: #1e3a8a;
  --imx-good: #067647;
  --imx-good-bg: #ecfdf3;
  --imx-good-line: #abefc6;
  --imx-good-solid: #12b76a;
  --imx-mid: #b54708;
  --imx-mid-bg: #fffaeb;
  --imx-mid-line: #fedf89;
  --imx-mid-solid: #f79009;
  --imx-low: #b42318;
  --imx-low-bg: #fef3f2;
  --imx-low-line: #fecdca;
  --imx-low-solid: #f04438;
  --imx-radius: 14px;
  --imx-radius-sm: 8px;
  --imx-shadow: 0 24px 48px -12px rgba(15, 23, 42, 0.28), 0 4px 12px rgba(15, 23, 42, 0.08);
  font-family: var(--imx-font);
  font-size: 13px;
  line-height: 1.45;
  color: var(--imx-text);
  -webkit-font-smoothing: antialiased;
}
:host *, .imx-popup * { box-sizing: border-box; }
/* L'hôte du Shadow DOM est remis à zéro (all: initial) : la carte et le bouton
   déclarent eux-mêmes police et couleur, sinon ils hériteraient de Times. */
.imx-card, .imx-launcher {
  font-family: var(--imx-font);
  font-size: 13px;
  line-height: 1.45;
  color: var(--imx-text);
  text-align: left;
  letter-spacing: normal;
  -webkit-font-smoothing: antialiased;
}
button, input, select { font-family: inherit; }

/* ─── Bouton des annonces : onglet collé au bord droit, à mi-hauteur ─── */
.imx-launcher {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px 11px 12px;
  border: none;
  border-radius: 12px 0 0 12px;
  background: var(--imx-accent);
  color: #fff;
  font: 600 13px/1 var(--imx-font);
  letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow: var(--imx-shadow);
  transition: padding 0.15s ease, background 0.15s ease;
  z-index: 2;
}
.imx-launcher:hover { background: var(--imx-accent-hover); padding-right: 18px; }
.imx-launcher:focus-visible { outline: 3px solid var(--imx-accent-line); outline-offset: 2px; }
.imx-launcher.is-saved { background: #047857; }
.imx-launcher.is-saved:hover { background: #065f46; }
.imx-launcher svg { flex: none; }
/* Pastille « ce bien apparaît dans N autres annonces » */
.imx-launcher-badge {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  background: #fbbf24;
  color: #3b2400;
  font: 800 11px/1 var(--imx-font);
}
.imx-seen { padding: 12px; border: 1px solid #fde68a; border-radius: 12px; background: #fffbeb; }
.imx-seen .imx-candidate { border-top-color: #fde68a; }

/* ─── Carte ─── */
.imx-card {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 384px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  background: var(--imx-bg);
  border: 1px solid var(--imx-border);
  border-radius: var(--imx-radius);
  box-shadow: var(--imx-shadow);
  z-index: 3;
  animation: imx-in 0.18s ease-out;
}
@keyframes imx-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .imx-card { animation: none; } }

.imx-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--imx-bg);
  border-bottom: 1px solid var(--imx-border);
}
.imx-logo {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--imx-accent);
  color: #fff;
}
.imx-brand { display: flex; flex-direction: column; min-width: 0; }
.imx-title { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
.imx-subtitle { font-size: 12px; color: var(--imx-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.imx-close {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--imx-text-3);
  cursor: pointer;
}
.imx-close:hover { background: var(--imx-bg-muted); color: var(--imx-text); }

.imx-body { display: grid; gap: 14px; padding: 14px; }
.imx-section { display: grid; gap: 8px; }
.imx-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.imx-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--imx-text-3);
}
.imx-link {
  border: none;
  background: none;
  padding: 0;
  font: 600 12px var(--imx-font);
  color: var(--imx-accent);
  text-decoration: none;
  cursor: pointer;
}
.imx-link:hover { text-decoration: underline; }

/* Critères lus sur l'annonce */
.imx-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.imx-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--imx-border);
  border-radius: 999px;
  background: var(--imx-bg-subtle);
  color: var(--imx-text-2);
  font-size: 12px;
  white-space: nowrap;
}
.imx-chip.has-badge { padding-left: 3px; }

/* Lettres DPE et GES aux couleurs officielles de l'étiquette */
.imx-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 800;
}
.imx-dpe-A { background: #009c6d; color: #fff; }
.imx-dpe-B { background: #52b153; color: #fff; }
.imx-dpe-C { background: #78bd76; color: #0b3b1e; }
.imx-dpe-D { background: #f4e70f; color: #4a4400; }
.imx-dpe-E { background: #f0b40f; color: #4a3500; }
.imx-dpe-F { background: #eb8235; color: #fff; }
.imx-dpe-G { background: #d7221f; color: #fff; }
.imx-ges-A { background: #f6edfd; color: #5b2a86; }
.imx-ges-B { background: #e4c7f5; color: #4b1f73; }
.imx-ges-C { background: #d5aaf0; color: #3f1763; }
.imx-ges-D { background: #cb95ed; color: #35105a; }
.imx-ges-E { background: #ba72e6; color: #fff; }
.imx-ges-F { background: #a74dd9; color: #fff; }
.imx-ges-G { background: #8f3fc0; color: #fff; }

/* Meilleure correspondance */
.imx-result {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--imx-border);
  border-radius: 12px;
  background: var(--imx-bg);
}
.imx-result.is-good { border-color: var(--imx-good-line); background: #fbfefc; }
.imx-result.is-mid { border-color: var(--imx-mid-line); background: #fffdf7; }
.imx-result.is-low { border-color: var(--imx-low-line); background: #fffbfa; }
.imx-address { font-size: 15px; font-weight: 700; line-height: 1.3; letter-spacing: -0.01em; }
.imx-meta { font-size: 12px; color: var(--imx-text-3); }
.imx-parcel { font: 600 12px ui-monospace, SFMono-Regular, Consolas, monospace; color: var(--imx-text-2); }
.imx-confidence { display: flex; align-items: center; gap: 10px; }
.imx-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.imx-pill::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.imx-pill.is-good { background: var(--imx-good-bg); color: var(--imx-good); }
.imx-pill.is-mid { background: var(--imx-mid-bg); color: var(--imx-mid); }
.imx-pill.is-low { background: var(--imx-low-bg); color: var(--imx-low); }
.imx-scorebar { flex: 1; height: 6px; border-radius: 999px; background: var(--imx-bg-muted); overflow: hidden; }
.imx-scorebar > span { display: block; height: 100%; border-radius: 999px; }
.imx-scorebar.is-good > span { background: var(--imx-good-solid); }
.imx-scorebar.is-mid > span { background: var(--imx-mid-solid); }
.imx-scorebar.is-low > span { background: var(--imx-low-solid); }
.imx-score { font-size: 12px; font-weight: 700; color: var(--imx-text-2); }

/* Boutons */
.imx-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.imx-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--imx-border-strong);
  border-radius: var(--imx-radius-sm);
  background: var(--imx-bg);
  color: var(--imx-text);
  font: 600 12.5px var(--imx-font);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.imx-btn:hover { background: var(--imx-bg-subtle); border-color: var(--imx-text-3); }
.imx-btn:focus-visible { outline: 3px solid var(--imx-accent-line); outline-offset: 1px; }
.imx-btn-primary { background: var(--imx-accent); border-color: var(--imx-accent); color: #fff; }
.imx-btn-primary:hover { background: var(--imx-accent-hover); border-color: var(--imx-accent-hover); }
.imx-btn-ghost { border-color: transparent; background: transparent; color: var(--imx-accent); }
.imx-btn-ghost:hover { background: var(--imx-accent-soft); border-color: transparent; }
.imx-btn-icon { width: 32px; padding: 0; }
.imx-btn-sm { height: 28px; padding: 0 9px; font-size: 12px; }
.imx-btn-sm.imx-btn-icon { width: 28px; }
.imx-btn-block { width: 100%; height: 38px; font-size: 13px; }
.imx-btn[disabled] { opacity: 0.45; cursor: default; }

/* Autres candidats */
.imx-candidates { display: grid; }
.imx-candidate { display: grid; gap: 4px; padding: 10px 0; border-top: 1px solid var(--imx-border); }
.imx-candidate:first-child { border-top: none; padding-top: 2px; }
.imx-candidate-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.imx-candidate-address { font-size: 13px; font-weight: 600; }
.imx-diffs { font-size: 11.5px; color: var(--imx-mid); }

/* Messages */
.imx-notice, .imx-alert, .imx-empty {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12.5px;
}
.imx-notice { background: var(--imx-accent-soft); color: var(--imx-accent-text); border: 1px solid var(--imx-accent-line); }
.imx-notice .imx-link { margin-left: auto; white-space: nowrap; }
.imx-alert { background: var(--imx-low-bg); color: var(--imx-low); border: 1px solid var(--imx-low-line); }
.imx-empty { background: var(--imx-mid-bg); color: var(--imx-mid); border: 1px solid var(--imx-mid-line); }
.imx-notice svg, .imx-alert svg, .imx-empty svg { flex: none; margin-top: 1px; }
.imx-loading { display: flex; align-items: center; gap: 10px; padding: 6px 0; color: var(--imx-text-2); font-size: 13px; }
.imx-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--imx-accent-line);
  border-top-color: var(--imx-accent);
  border-radius: 999px;
  animation: imx-spin 0.7s linear infinite;
}
@keyframes imx-spin { to { transform: rotate(360deg); } }

/* Formulaires */
.imx-form { display: grid; gap: 12px; }
.imx-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.imx-field { display: grid; gap: 5px; min-width: 0; }
.imx-field > span, .imx-field-label { font-size: 12px; font-weight: 600; color: var(--imx-text-2); }
.imx-field small { font-size: 11.5px; color: var(--imx-text-3); }
.imx-input, .imx-select {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--imx-border-strong);
  border-radius: var(--imx-radius-sm);
  background: var(--imx-bg);
  color: var(--imx-text);
  font-size: 13px;
  outline: none;
}
.imx-input::placeholder { color: #94a3b8; }
.imx-input:focus, .imx-select:focus { border-color: var(--imx-accent); box-shadow: 0 0 0 3px var(--imx-accent-line); }
.imx-letters { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
.imx-letter {
  height: 30px;
  border: 1px solid var(--imx-border-strong);
  border-radius: 7px;
  background: var(--imx-bg);
  color: var(--imx-text-2);
  font: 800 12px var(--imx-font);
  cursor: pointer;
}
.imx-letter:hover { border-color: var(--imx-text-3); }
.imx-letter.is-none { font-weight: 600; color: var(--imx-text-3); }
.imx-letter.is-selected { border-color: transparent; box-shadow: 0 0 0 2px var(--imx-text); }
.imx-letter.is-none.is-selected { background: var(--imx-bg-muted); }
.imx-form-actions { display: flex; gap: 8px; }
.imx-form-actions .imx-btn-primary { flex: 1; }

/* Pied de carte */
.imx-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--imx-border);
  background: var(--imx-bg-subtle);
  border-radius: 0 0 var(--imx-radius) var(--imx-radius);
  font-size: 11.5px;
  color: var(--imx-text-3);
}

/* ─── Popup ─── */
body.imx-popup { width: 384px; margin: 0; background: var(--imx-bg-subtle); }
.imx-popup-header { display: flex; align-items: center; gap: 10px; padding: 14px 16px; background: var(--imx-bg); border-bottom: 1px solid var(--imx-border); }
.imx-popup-header .imx-version { margin-left: auto; font-size: 11px; color: var(--imx-text-3); }
.imx-popup-main { display: grid; gap: 14px; padding: 14px 16px 16px; }
.imx-tabs { display: grid; grid-template-columns: repeat(5, auto); gap: 2px; padding: 3px; border-radius: 10px; background: var(--imx-bg-muted); }
.imx-tab {
  height: 30px;
  padding: 0 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--imx-text-2);
  font: 600 12.5px var(--imx-font);
  cursor: pointer;
}
.imx-tab:hover { color: var(--imx-text); }
.imx-tab.is-active { background: var(--imx-bg); color: var(--imx-text); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12); }
.imx-analyze {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--imx-accent-line);
  border-radius: 12px;
  background: var(--imx-accent-soft);
  color: var(--imx-accent-text);
  text-align: left;
  cursor: pointer;
}
.imx-analyze:hover { border-color: var(--imx-accent); }
.imx-analyze-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 10px; background: var(--imx-accent); color: #fff; flex: none; }
.imx-analyze-text strong { display: block; font-size: 13.5px; }
.imx-analyze-text span { display: block; font-size: 12px; color: #3b5bdb; }
.imx-panel { display: grid; gap: 12px; padding: 14px; background: var(--imx-bg); border: 1px solid var(--imx-border); border-radius: 12px; }
.imx-history { display: grid; gap: 8px; max-height: 360px; overflow-y: auto; }
.imx-history-item {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid var(--imx-border);
  border-radius: 10px;
  background: var(--imx-bg);
  cursor: pointer;
  text-align: left;
}
.imx-history-item:hover, .imx-history-item:focus-visible { border-color: var(--imx-accent); outline: none; }
.imx-history-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--imx-text-3); }
.imx-history-address { font-size: 13px; font-weight: 700; }
.imx-sites { display: grid; gap: 6px; }
.imx-site { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12.5px; }
.imx-hidden { display: none !important; }
.imx-site-bar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--imx-border); border-radius: 12px; background: var(--imx-bg); font-size: 12.5px; color: var(--imx-text-2); }
.imx-site-bar strong { color: var(--imx-text); }
.imx-site-bar .imx-btn { margin-left: auto; }
.imx-popup-footer { display: flex; justify-content: space-between; padding: 0 16px 14px; font-size: 11px; color: var(--imx-text-3); }
.imx-popup-footer a { color: var(--imx-text-3); text-decoration: none; }
.imx-popup-footer a:hover { color: var(--imx-text); text-decoration: underline; }
`;

  // Dans le popup (page de l'extension), la feuille s'applique d'elle-même ;
  // sur les annonces, overlay.js l'injecte dans son Shadow DOM.
  if (location.protocol === 'chrome-extension:' && document.head) {
    const style = document.createElement('style');
    style.textContent = window.__immodexCSS;
    document.head.appendChild(style);
  }
})();
