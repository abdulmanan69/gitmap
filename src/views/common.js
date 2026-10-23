/** Shared helpers for views: crumbs, legend, icons, fills. */
import { escapeHtml, fmtPct } from '../utils/format.js';
import { languageColor } from '../model/languages.js';

export const ICONS = {
  overview: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 7.25 10h-5.5A1.75 1.75 0 0 1 0 8.25v-5.5C0 1.784.784 1 1.75 1ZM1.5 2.75v5.5c0 .138.112.25.25.25h5.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25h-5.5a.25.25 0 0 0-.25.25Zm8.25-1.75h4.5c.966 0 1.75.784 1.75 1.75v2.5a1.75 1.75 0 0 1-1.75 1.75h-4.5A1.75 1.75 0 0 1 8 5.25v-2.5C8 1.784 8.784 1 9.75 1Zm-.25 1.75v2.5c0 .138.112.25.25.25h4.5a.25.25 0 0 0 .25-.25v-2.5a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25ZM1.75 11.5h3.5c.966 0 1.75.784 1.75 1.75v.5A1.75 1.75 0 0 1 5.25 15.5h-3.5A1.75 1.75 0 0 1 0 13.75v-.5c0-.966.784-1.75 1.75-1.75Zm7-3.5h5.5c.966 0 1.75.784 1.75 1.75v4a1.75 1.75 0 0 1-1.75 1.75h-5.5A1.75 1.75 0 0 1 7 13.75v-4C7 8.784 7.784 8 8.75 8Zm-.25 1.75v4c0 .138.112.25.25.25h5.5a.25.25 0 0 0 .25-.25v-4a.25.25 0 0 0-.25-.25h-5.5a.25.25 0 0 0-.25.25Z"/></svg>',
  treemap: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75C0 1.784.784 1 1.75 1ZM1.5 2.75v10.5c0 .138.112.25.25.25H7V2.5H1.75a.25.25 0 0 0-.25.25ZM8.5 2.5v5h6V2.75a.25.25 0 0 0-.25-.25Zm0 6.5v4.5h5.75a.25.25 0 0 0 .25-.25V9Z"/></svg>',
  atlas: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm0 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6 4.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 3.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"/></svg>',
  sunburst: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm0 1.5a6.5 6.5 0 0 0-6.5 6.5c0 1.2.33 2.33.9 3.3l2.6-1.5A3.5 3.5 0 0 1 4.5 8c0-.51.11-1 .3-1.46L2.2 5.04A6.47 6.47 0 0 1 8 1.5Zm0 4.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm5.8-1.96-2.6 1.5c.19.45.3.95.3 1.46 0 .51-.11 1-.3 1.46l2.6 1.5A6.47 6.47 0 0 0 14.5 8c0-1.2-.33-2.33-.9-3.3ZM8 14.5a6.47 6.47 0 0 0 5.8-3.54l-2.6-1.5A3.5 3.5 0 0 1 8 11.5a3.5 3.5 0 0 1-3.2-2.04l-2.6 1.5A6.47 6.47 0 0 0 8 14.5Z"/></svg>',
  explorer: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Zm0 1.5h3.25c.08 0 .15.04.2.1l.9 1.2c.33.44.85.7 1.4.7h6.75a.25.25 0 0 1 .25.25v8.5a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25V2.75a.25.25 0 0 1 .25-.25Z"/></svg>',
  deps: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 1a2.5 2.5 0 0 1 .75 4.886V7.25h3.5A1.75 1.75 0 0 1 14 9v1.114a2.5 2.5 0 1 1-1.5 0V9a.25.25 0 0 0-.25-.25h-8.5A.25.25 0 0 0 3.5 9v1.114a2.5 2.5 0 1 1-1.5 0V9a1.75 1.75 0 0 1 1.75-1.75h3.5V5.886A2.5 2.5 0 0 1 8 1Zm0 1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-5.25 9a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm10.5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>',
  people: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5ZM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.954.752.752 0 0 1-.549-.514 3.507 3.507 0 0 0-2.522-2.372.75.75 0 0 1-.574-.73v-.352a.75.75 0 0 1 .416-.672A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4Zm-5.5-.5a2 2 0 1 0-.001 3.999A2 2 0 0 0 5.5 3.5Z"/></svg>',
  up: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3.22 9.78a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018L8 6.06 4.28 9.78a.75.75 0 0 1-1.06 0Z"/></svg>',
  search: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/></svg>',
  external: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"/></svg>',
};

/** Breadcrumb trail. nodes: model nodes (root first). */
export function renderCrumbs(el, nodes, onClick) {
  el.innerHTML = '';
  nodes.forEach((n, i) => {
    const last = i === nodes.length - 1;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `crumb${last ? ' is-current' : ''}`;
    b.textContent = n.name;
    b.title = n.path || n.name;
    if (!last) b.addEventListener('click', () => onClick(n, i));
    else b.disabled = true;
    el.appendChild(b);
    if (!last) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '/';
      el.appendChild(sep);
    }
  });
}

/** Language legend from a Map(lang -> bytes). onHover(lang|null). */
export function renderLegend(el, langBytes, { max = 8, onHover = null } = {}) {
  if (!el) return;
  el.innerHTML = '';
  if (!langBytes || !langBytes.size) { el.hidden = true; return; }
  el.hidden = false;
  const total = [...langBytes.values()].reduce((a, b) => a + b, 0) || 1;
  const entries = [...langBytes.entries()].sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, max);
  const rest = entries.slice(max).reduce((s, [, b]) => s + b, 0);
  for (const [lang, bytes] of top) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML = `<i class="legend-swatch" style="background:${languageColor(lang)}"></i>${escapeHtml(lang)} <span class="pct">${fmtPct(bytes / total, 0)}</span>`;
    if (onHover) {
      item.style.cursor = 'default';
      item.addEventListener('mouseenter', () => onHover(lang));
      item.addEventListener('mouseleave', () => onHover(null));
    }
    el.appendChild(item);
  }
  if (rest > 0) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML = `<i class="legend-swatch" style="background:var(--ink-3)"></i>other <span class="pct">${fmtPct(rest / total, 0)}</span>`;
    el.appendChild(item);
  }
}

/** Fill for a directory shape: language hue tinted into the surface, stronger with depth. */
export function dirFill(lang, depth = 1) {
  const pct = Math.min(46, 14 + depth * 7);
  return `color-mix(in srgb, ${languageColor(lang)} ${pct}%, var(--surface-2))`;
}

/** Truncate text to fit a pixel width at an average glyph width. */
export function fitText(text, widthPx, charW = 6.6) {
  const max = Math.floor(widthPx / charW);
  if (max <= 0) return '';
  if (text.length <= max) return text;
  if (max <= 2) return '…';
  return text.slice(0, max - 1) + '…';
}

export function emptyState(title, body) {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><span>${body}</span></div>`;
}

export function card({ span = 12, title, sub = '', body = '', i = 0, extraClass = '' }) {
  return `<section class="card span-${span} ${extraClass}" style="--i:${i}">
    ${title ? `<div class="card-head"><h3>${escapeHtml(title)}</h3>${sub ? `<span class="sub">${sub}</span>` : ''}</div>` : ''}
    ${body}
  </section>`;
}
