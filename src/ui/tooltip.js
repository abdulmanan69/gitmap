import { fmtBytes, fmtInt, fmtPct, escapeHtml } from '../utils/format.js';
import { languageColor } from '../model/languages.js';

let tip = null;
function elTip() { return tip || (tip = document.getElementById('tooltip')); }

export function showTip(html, event) {
  const t = elTip();
  if (!t) return;
  t.innerHTML = html;
  t.hidden = false;
  if (event) moveTip(event);
}

export function moveTip(event) {
  const t = elTip();
  if (!t || t.hidden) return;
  const pad = 14;
  const { innerWidth: W, innerHeight: H } = window;
  const r = t.getBoundingClientRect();
  let x = event.clientX + pad, y = event.clientY + pad;
  if (x + r.width > W - 8) x = event.clientX - r.width - pad;
  if (y + r.height > H - 8) y = event.clientY - r.height - pad;
  t.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}

export function hideTip() {
  const t = elTip();
  if (t) t.hidden = true;
}

/** Tooltip body for a hierarchy node (raw model node or pruned copy). */
export function nodeTip(node, totalBytes) {
  const color = languageColor(node.lang);
  const rows = [];
  if (node.type === 'dir') {
    rows.push(['Files', fmtInt(node.files)]);
    if (node.dirs) rows.push(['Folders', fmtInt(node.dirs)]);
  } else if (node.type === 'group') {
    rows.push(['Files folded', fmtInt(node.count)]);
  }
  rows.push(['Size', fmtBytes(node.size)]);
  if (totalBytes) rows.push(['Share', fmtPct(node.size / totalBytes)]);
  rows.push([node.type === 'dir' ? 'Mostly' : 'Language', node.lang]);
  const zoomable = node.type === 'dir' && node.children && node.children.length;
  return `
    <div class="t-title"><i style="background:${color}"></i>${escapeHtml(node.name)}${node.type === 'dir' ? '/' : ''}</div>
    ${node.path ? `<div class="t-path">${escapeHtml(node.path)}</div>` : ''}
    ${rows.map(([k, v]) => `<div class="t-row"><span>${k}</span><b>${escapeHtml(v)}</b></div>`).join('')}
    ${zoomable ? '<div class="t-row"><span style="color:var(--ink-3)">Click to zoom in</span></div>' : ''}
  `;
}

/** Attach hover tooltip behaviour to a d3 selection; html(d, event) returns content. */
export function bindTip(selection, html) {
  selection
    .on('mouseenter.tip', (event, d) => showTip(html(d, event), event))
    .on('mousemove.tip', (event) => moveTip(event))
    .on('mouseleave.tip', hideTip);
  return selection;
}
