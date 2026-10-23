/** Explorer: collapsible tree, search, and file preview with syntax highlighting. */
import { fmtBytes, fmtInt, escapeHtml } from '../utils/format.js';
import { languageColor, isBinaryName, isImageName, hljsLanguage } from '../model/languages.js';
import { findByPath } from '../model/tree.js';
import { debounce } from '../utils/dom.js';
import { ghLink } from '../ui/inspector.js';
import { ICONS } from './common.js';

const HLJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';
const MAX_PREVIEW_BYTES = 1_500_000;
const MAX_LINES = 8000;
let hljsPromise = null;

function loadHljs() {
  if (window.hljs) return Promise.resolve(window.hljs);
  if (!hljsPromise) {
    hljsPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = HLJS_URL; s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.hljs || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }
  return hljsPromise;
}

/** Split highlighted HTML into lines, re-opening spans that cross line breaks. */
function splitHighlighted(html) {
  const lines = html.split('\n');
  const open = [];
  const out = [];
  const tagRe = /<span[^>]*>|<\/span>/g;
  for (const line of lines) {
    const prefix = open.join('');
    let m;
    tagRe.lastIndex = 0;
    while ((m = tagRe.exec(line))) {
      if (m[0] === '</span>') open.pop(); else open.push(m[0]);
    }
    out.push(prefix + line + '</span>'.repeat(open.length));
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default {
  id: 'explorer',
  label: 'Explorer',
  key: '5',
  icon: ICONS.explorer,
  mount(container, ctx) {
    const { root, index, repo, client } = ctx;
    container.innerHTML = `
      <div class="explorer">
        <div class="explorer-side">
          <div class="view-toolbar">
            <div class="search">${ICONS.search}<input class="input" data-search type="search" placeholder="Find files by name or path" aria-label="Find files" spellcheck="false" /><kbd>/</kbd></div>
            <div class="seg" role="group" aria-label="Sort"><button type="button" data-sort="size" class="is-active">Size</button><button type="button" data-sort="name">Name</button></div>
          </div>
          <div class="tree" data-tree role="tree"></div>
          <div class="tree-results" data-results hidden></div>
        </div>
        <div class="explorer-main">
          <div class="file-head" data-head><span class="path"><span>Select a file to preview it</span></span></div>
          <div class="file-body" data-body>
            <div class="file-empty"><div><div class="big">Pick a file</div>Browse the tree or search by name. Text files render with syntax colours, images show inline.</div></div>
          </div>
          <div class="file-meta" data-meta hidden></div>
        </div>
      </div>`;

    const treeEl = container.querySelector('[data-tree]');
    const resultsEl = container.querySelector('[data-results]');
    const searchEl = container.querySelector('[data-search]');
    const headEl = container.querySelector('[data-head]');
    const bodyEl = container.querySelector('[data-body]');
    const metaEl = container.querySelector('[data-meta]');
    let sortMode = 'size';
    let selectedPath = null;
    let requestId = 0;
    const openPaths = new Set(['']);

    const sorter = () => (sortMode === 'size'
      ? (a, b) => (b.type === 'dir') - (a.type === 'dir') || b.size - a.size || a.name.localeCompare(b.name)
      : (a, b) => (b.type === 'dir') - (a.type === 'dir') || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    function rowFor(node) {
      const isDir = node.type === 'dir';
      const row = document.createElement('div');
      row.className = `tree-node${isDir && openPaths.has(node.path) ? ' is-open' : ''}${node.path === selectedPath ? ' is-selected' : ''}`;
      row.setAttribute('role', 'treeitem');
      row.dataset.path = node.path;
      row.innerHTML = `
        ${isDir ? '<span class="twisty"><svg viewBox="0 0 16 16" width="10" height="10"><path fill="currentColor" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg></span>' : '<span class="twisty"></span>'}
        <span class="ico ${isDir ? 'folder' : ''}" style="${isDir ? '' : `background:${languageColor(node.lang)}`}"></span>
        <span class="nm">${escapeHtml(node.name)}</span>
        <span class="sz">${isDir ? fmtInt(node.files) : fmtBytes(node.size)}</span>`;
      row.addEventListener('click', () => {
        if (isDir) { toggleDir(node, row); ctx.select(node); }
        else selectFile(node);
      });
      return row;
    }

    function renderChildren(node, into) {
      const kids = [...node.children].sort(sorter());
      const frag = document.createDocumentFragment();
      for (const c of kids) {
        const row = rowFor(c);
        frag.appendChild(row);
        if (c.type === 'dir' && openPaths.has(c.path)) {
          const box = document.createElement('div');
          box.className = 'tree-children';
          renderChildren(c, box);
          frag.appendChild(box);
        }
      }
      into.appendChild(frag);
    }

    function toggleDir(node, row) {
      const next = row.nextElementSibling;
      if (openPaths.has(node.path)) {
        openPaths.delete(node.path);
        row.classList.remove('is-open');
        if (next && next.classList.contains('tree-children')) next.remove();
      } else {
        openPaths.add(node.path);
        row.classList.add('is-open');
        const box = document.createElement('div');
        box.className = 'tree-children';
        renderChildren(node, box);
        row.after(box);
      }
    }

    function renderTree() {
      treeEl.innerHTML = '';
      renderChildren(root, treeEl);
    }

    function reveal(path) {
      const parts = path.split('/');
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        openPaths.add(acc);
      }
      renderTree();
      const row = treeEl.querySelector(`[data-path="${CSS.escape(path)}"]`);
      if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function markSelected() {
      treeEl.querySelectorAll('.tree-node.is-selected').forEach((r) => r.classList.remove('is-selected'));
      if (selectedPath !== null) {
        const row = treeEl.querySelector(`[data-path="${CSS.escape(selectedPath)}"]`);
        if (row) row.classList.add('is-selected');
      }
    }

    async function selectFile(node) {
      selectedPath = node.path;
      markSelected();
      ctx.select(node);
      const id = ++requestId;
      const gh = ghLink(node, repo);
      const raw = client.rawUrl(repo.owner, repo.repo, repo.ref, node.path);
      const dir = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/') + 1) : '';
      headEl.innerHTML = `
        <span class="path"><span>${escapeHtml(dir)}</span><b>${escapeHtml(node.name)}</b></span>
        <a class="btn btn-sm" href="${gh}" target="_blank" rel="noopener">GitHub ${ICONS.external}</a>
        <a class="btn btn-sm" href="${raw}" target="_blank" rel="noopener">Raw ${ICONS.external}</a>`;
      metaEl.hidden = false;
      metaEl.innerHTML = `<span><b>${fmtBytes(node.size)}</b></span><span>${escapeHtml(node.lang)}</span>${node.sha ? `<span>blob <b>${node.sha.slice(0, 10)}</b></span>` : ''}<span data-lines></span>`;

      if (node.type === 'submodule') {
        bodyEl.innerHTML = `<div class="file-empty"><div><div class="big">Git submodule</div>This entry points to another repository at commit <code>${escapeHtml((node.sha || '').slice(0, 12))}</code>.</div></div>`;
        return;
      }
      if (isImageName(node.name)) {
        bodyEl.innerHTML = `<div style="padding:12px"><img src="${raw}" alt="${escapeHtml(node.name)}" loading="lazy" /></div>`;
        return;
      }
      if (isBinaryName(node.name)) {
        bodyEl.innerHTML = `<div class="file-empty"><div><div class="big">Binary file</div>${fmtBytes(node.size)} · no text preview. <a href="${gh}" target="_blank" rel="noopener">Open on GitHub</a></div></div>`;
        return;
      }
      if (node.size > MAX_PREVIEW_BYTES) {
        bodyEl.innerHTML = `<div class="file-empty"><div><div class="big">Too large to preview</div>${fmtBytes(node.size)} is over the ${fmtBytes(MAX_PREVIEW_BYTES)} preview limit. <a href="${gh}" target="_blank" rel="noopener">Open on GitHub</a></div></div>`;
        return;
      }
      bodyEl.innerHTML = '<div class="file-empty"><div class="muted">Loading…</div></div>';
      try {
        const [text, hljs] = await Promise.all([client.fetchText(repo.owner, repo.repo, repo.ref, node.path, { maxBytes: MAX_PREVIEW_BYTES }), loadHljs()]);
        if (id !== requestId) return;
        const lang = hljsLanguage(node.name);
        const allLines = text.split('\n');
        const total = allLines.length;
        const truncatedLines = total > MAX_LINES;
        const source = truncatedLines ? allLines.slice(0, MAX_LINES).join('\n') : text;
        let lines;
        if (hljs && lang !== 'plaintext' && hljs.getLanguage(lang) && source.length < 600_000) {
          lines = splitHighlighted(hljs.highlight(source, { language: lang, ignoreIllegals: true }).value);
        } else {
          lines = escapeHtml(source).split('\n');
        }
        const html = lines.map((l, i) => `<span class="line"><span class="ln">${i + 1}</span>${l || ' '}</span>`).join('');
        bodyEl.innerHTML = `<pre><code class="hljs">${html}</code>${truncatedLines ? `<div class="muted" style="padding:10px 16px">Showing the first ${fmtInt(MAX_LINES)} of ${fmtInt(total)} lines.</div>` : ''}</pre>`;
        metaEl.querySelector('[data-lines]').textContent = `${fmtInt(total)} lines`;
      } catch (err) {
        if (id !== requestId) return;
        bodyEl.innerHTML = `<div class="file-empty"><div><div class="big">Could not load file</div>${escapeHtml(err.message || String(err))}<br/><a href="${gh}" target="_blank" rel="noopener">Open on GitHub</a></div></div>`;
      }
    }

    // ---- search ----
    const allPaths = [...index.keys()].filter(Boolean);
    function runSearch(q) {
      const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!tokens.length) { resultsEl.hidden = true; treeEl.hidden = false; return; }
      const hits = [];
      for (const p of allPaths) {
        const lower = p.toLowerCase();
        if (!tokens.every((t) => lower.includes(t))) continue;
        const name = lower.slice(lower.lastIndexOf('/') + 1);
        const score = tokens.reduce((s, t) => s + (name.startsWith(t) ? 3 : name.includes(t) ? 2 : 1), 0) - p.length / 400;
        hits.push({ p, score });
        if (hits.length > 4000) break;
      }
      hits.sort((a, b) => b.score - a.score);
      const shown = hits.slice(0, 300);
      const hl = (s) => { let out = escapeHtml(s); for (const t of tokens) out = out.replace(new RegExp(escapeRe(escapeHtml(t)), 'ig'), (m) => `<mark>${m}</mark>`); return out; };
      resultsEl.innerHTML = shown.length ? `
        <div class="muted" style="padding:6px 10px;font-size:var(--fs-xs)">${fmtInt(hits.length)} match${hits.length === 1 ? '' : 'es'}${hits.length > shown.length ? `, showing ${shown.length}` : ''}</div>
        ${shown.map(({ p }) => { const n = index.get(p); return `
          <div class="result-row${p === selectedPath ? ' is-selected' : ''}" data-path="${escapeHtml(p)}">
            <span class="nm"><i style="background:${n.type === 'dir' ? 'var(--ink-3)' : languageColor(n.lang)}"></i>${hl(n.name)}${n.type === 'dir' ? '/' : ''}<span class="muted" style="margin-left:auto;font-size:11px">${n.type === 'dir' ? `${fmtInt(n.files)} files` : fmtBytes(n.size)}</span></span>
            <span class="pth">${hl(p)}</span>
          </div>`; }).join('')}`
        : '<div class="empty"><strong>No matches</strong><span>Try fewer or shorter words.</span></div>';
      resultsEl.hidden = false; treeEl.hidden = true;
    }
    searchEl.addEventListener('input', debounce(() => runSearch(searchEl.value), 110));
    searchEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { searchEl.value = ''; runSearch(''); searchEl.blur(); } });
    resultsEl.addEventListener('click', (e) => {
      const row = e.target.closest('.result-row');
      if (!row) return;
      const node = index.get(row.dataset.path);
      if (!node) return;
      if (node.type === 'dir') { searchEl.value = ''; runSearch(''); openPaths.add(node.path); reveal(node.path); ctx.select(node); }
      else { selectFile(node); resultsEl.querySelectorAll('.is-selected').forEach((r) => r.classList.remove('is-selected')); row.classList.add('is-selected'); }
    });

    container.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      sortMode = b.dataset.sort;
      container.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('is-active', x === b));
      renderTree();
    }));

    function open(path) {
      const node = path ? (index.get(path) || findByPath(root, path)) : null;
      if (!node) { renderTree(); return; }
      if (node.type === 'dir') { openPaths.add(node.path); reveal(node.path); ctx.select(node); }
      else { reveal(node.path); selectFile(node); }
    }

    renderTree();
    if (ctx.state.path) open(ctx.state.path);

    return {
      unmount() { requestId++; },
      svg: () => null,
      focusPath(path) { open(path); },
      focusSearch() { searchEl.focus(); searchEl.select(); },
    };
  },
};
