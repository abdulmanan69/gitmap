import { copyText } from '../utils/dom.js';
import { fmtBytes, fmtInt, fmtPct, escapeHtml } from '../utils/format.js';
import { languageColor } from '../model/languages.js';
import { toast } from './toast.js';

let host = null;
let current = null;

function hostEl() { return host || (host = document.getElementById('inspector')); }

export function currentSelection() { return current; }

export function hideInspector() {
  const h = hostEl();
  if (!h) return;
  h.hidden = true;
  h.innerHTML = '';
  current = null;
}

/**
 * Show details for a node.
 * ctx: { repo: {owner, repo, ref}, totalBytes, onZoom(node), onOpenFile(node) }
 */
export function showInspector(node, ctx) {
  const h = hostEl();
  if (!h || !node) return;
  current = node;
  const color = languageColor(node.lang);
  const isDir = node.type === 'dir';
  const isGroup = node.type === 'group';
  const ghUrl = ghLink(node, ctx.repo);
  const kv = [];
  kv.push(['Type', isDir ? 'Folder' : isGroup ? 'Folded files' : node.type === 'submodule' ? 'Submodule' : 'File']);
  kv.push(['Size', fmtBytes(node.size)]);
  if (ctx.totalBytes) kv.push(['Share of repo', fmtPct(node.size / ctx.totalBytes, 2)]);
  if (isDir) { kv.push(['Files inside', fmtInt(node.files)]); kv.push(['Folders inside', fmtInt(node.dirs)]); kv.push(['Deepest level', fmtInt(node.maxDepth)]); }
  if (isGroup) kv.push(['Files', fmtInt(node.count)]);
  kv.push([isDir ? 'Mostly' : 'Language', node.lang]);
  if (!isDir && node.ext) kv.push(['Extension', `.${node.ext}`]);
  kv.push(['Depth', fmtInt(node.depth)]);
  if (node.sha) kv.push(['Blob', node.sha.slice(0, 10)]);

  let langs = '';
  if (isDir && node.langBytes && node.langBytes.size > 1) {
    const total = [...node.langBytes.values()].reduce((a, b) => a + b, 0) || 1;
    const top = [...node.langBytes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    langs = `<h4 style="margin:14px 0 8px;font-size:12px;color:var(--ink-3);font-weight:500;text-transform:uppercase;letter-spacing:.06em">Languages inside</h4>
      <div class="bars">${top.map(([l, b]) => `
        <div class="bar-row"><span class="name"><i style="background:${languageColor(l)}"></i>${escapeHtml(l)}</span>
        <span class="track"><span class="fill" style="background:${languageColor(l)};width:${((b / total) * 100).toFixed(1)}%"></span></span>
        <span class="val">${fmtPct(b / total)}</span></div>`).join('')}</div>`;
  }

  h.innerHTML = `
    <div class="inspector-head">
      <span class="swatch" style="background:${color}"></span>
      <div class="inspector-title">
        <h3>${escapeHtml(node.name)}${isDir ? '/' : ''}</h3>
        <div class="path">${escapeHtml(node.path || '/')}</div>
      </div>
      <button class="btn btn-icon btn-sm" data-close aria-label="Close details">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>
      </button>
    </div>
    <div class="inspector-body">
      <dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
      ${langs}
    </div>
    <div class="inspector-actions">
      ${ghUrl ? `<a class="btn btn-sm" href="${ghUrl}" target="_blank" rel="noopener">Open on GitHub</a>` : ''}
      <button class="btn btn-sm" data-copy>Copy path</button>
      ${isDir && ctx.onZoom ? '<button class="btn btn-sm" data-zoom>Zoom here</button>' : ''}
      ${!isDir && !isGroup && ctx.onOpenFile ? '<button class="btn btn-sm btn-primary" data-open>Preview file</button>' : ''}
      ${isDir && ctx.onOpenFile ? '<button class="btn btn-sm" data-open>Browse in Explorer</button>' : ''}
    </div>`;
  h.hidden = false;

  h.querySelector('[data-close]').addEventListener('click', hideInspector);
  h.querySelector('[data-copy]').addEventListener('click', async () => {
    const ok = await copyText(node.path || '/');
    toast({ title: ok ? 'Path copied' : 'Could not copy', body: node.path || '/', type: ok ? 'success' : 'error', timeout: 2500 });
  });
  const zoomBtn = h.querySelector('[data-zoom]');
  if (zoomBtn) zoomBtn.addEventListener('click', () => ctx.onZoom(node));
  const openBtn = h.querySelector('[data-open]');
  if (openBtn) openBtn.addEventListener('click', () => ctx.onOpenFile(node));
}

export function ghLink(node, repo) {
  if (!repo) return null;
  const base = `https://github.com/${repo.owner}/${repo.repo}`;
  if (!node.path || node.type === 'group') return base;
  const kind = node.type === 'dir' ? 'tree' : 'blob';
  return `${base}/${kind}/${encodeURIComponent(repo.ref)}/${node.path.split('/').map(encodeURIComponent).join('/')}`;
}
