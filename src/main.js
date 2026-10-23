/**
 * GitMap — application shell.
 * Wires the landing page, the survey pipeline (GitHub API), the view registry,
 * the inspector, settings, exports, URL state and keyboard shortcuts.
 */
import { GitHubClient, GitHubError, parseRepoInput } from './api/github.js';
import { buildHierarchy, computeStats, healthChecks, pruneHierarchy } from './model/tree.js';
import { fmtBytes, fmtInt, fmtCompact, escapeHtml } from './utils/format.js';
import { $, $$, el, copyText } from './utils/dom.js';
import { initHero } from './ui/hero.js';
import { createLoader } from './ui/loader.js';
import { toast } from './ui/toast.js';
import { initTheme, toggleTheme } from './ui/theme.js';
import { showInspector, hideInspector } from './ui/inspector.js';
import { hideTip } from './ui/tooltip.js';
import { downloadSvg, downloadPng, downloadJson, exportTreeJson, copyMarkdownTree } from './export/export.js';
import overviewView from './views/overview.js';
import treemapView from './views/treemap.js';
import atlasView from './views/atlas.js';
import sunburstView from './views/sunburst.js';
import explorerView from './views/explorer.js';
import depsView from './views/deps.js';
import peopleView from './views/people.js';

const VIEWS = [overviewView, treemapView, atlasView, sunburstView, explorerView, depsView, peopleView];
const SETTINGS_KEY = 'gitmap:settings';
const TOKEN_KEY = 'gitmap:token';
const STEPS = [
  { id: 'repo', label: 'Locating repository' },
  { id: 'tree', label: 'Surveying the file tree' },
  { id: 'langs', label: 'Sampling languages' },
  { id: 'people', label: 'Charting people and history' },
  { id: 'draw', label: 'Drawing the map' },
];

const app = {
  client: null,
  settings: { maxNodes: 2500, remember: false, token: null },
  ctx: null,
  viewId: 'overview',
  viewInstance: null,
  viewEl: null,
  hero: null,
  loadSeq: 0,
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(app.settings, JSON.parse(raw));
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) { app.settings.token = token; app.settings.remember = true; }
  } catch { /* storage blocked */ }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ maxNodes: app.settings.maxNodes, remember: app.settings.remember }));
    if (app.settings.remember && app.settings.token) localStorage.setItem(TOKEN_KEY, app.settings.token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked */ }
}

function initSettingsDialog() {
  const dialog = $('#settings');
  const tokenInput = $('#token-input');
  const remember = $('#token-remember');
  const maxNodes = $('#maxnodes-input');
  const maxLabel = $('#maxnodes-label');

  const open = () => {
    tokenInput.value = app.settings.token || '';
    remember.checked = !!app.settings.remember;
    maxNodes.value = app.settings.maxNodes;
    maxLabel.textContent = `${fmtInt(app.settings.maxNodes)} shapes`;
    dialog.showModal();
  };
  $('#btn-settings').addEventListener('click', open);
  maxNodes.addEventListener('input', () => { maxLabel.textContent = `${fmtInt(maxNodes.value)} shapes`; });
  $('#btn-clear-cache').addEventListener('click', () => {
    app.client.clearCache();
    if (app.ctx) app.ctx.cache = {};
    toast({ title: 'Cache cleared', body: 'The next survey will ask GitHub again.', type: 'success', timeout: 2500 });
  });
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'save') return;
    const newToken = tokenInput.value.trim() || null;
    const tokenChanged = newToken !== (app.settings.token || null);
    const newMax = Number(maxNodes.value) || 2500;
    const maxChanged = newMax !== app.settings.maxNodes;
    app.settings.token = newToken;
    app.settings.remember = remember.checked;
    app.settings.maxNodes = newMax;
    app.client.setToken(newToken);
    saveSettings();
    if (tokenChanged) {
      app.client.clearCache();
      toast({ title: newToken ? 'Token set' : 'Token removed', body: newToken ? 'Requests now use your token. Map the repository again to pick up private data.' : 'Back to anonymous access (60 requests per hour).', type: 'success', timeout: 3500 });
    }
    if (maxChanged && app.ctx) {
      app.ctx.cache.pruned = null;
      if (app.viewId === 'atlas' || app.viewId === 'sunburst') switchView(app.viewId, { force: true });
    }
  });
  return { open };
}

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

function readUrl() {
  const p = new URLSearchParams(location.search);
  return { repo: p.get('repo'), ref: p.get('ref'), view: p.get('view'), path: p.get('path'), dir: p.get('dir') };
}

function writeUrl({ push = false } = {}) {
  if (!app.ctx) return;
  const p = new URLSearchParams();
  p.set('repo', `${app.ctx.repo.owner}/${app.ctx.repo.repo}`);
  if (app.ctx.repo.ref !== (app.ctx.repo.meta && app.ctx.repo.meta.default_branch)) p.set('ref', app.ctx.repo.ref);
  if (app.ctx.repo.subPath) p.set('dir', app.ctx.repo.subPath);
  if (app.viewId !== 'overview') p.set('view', app.viewId);
  if (app.ctx.state.path) p.set('path', app.ctx.state.path);
  const url = `${location.pathname}?${p.toString()}`;
  const state = { repo: p.get('repo'), ref: app.ctx.repo.ref, view: app.viewId, path: app.ctx.state.path, dir: app.ctx.repo.subPath || null };
  if (push) history.pushState(state, '', url); else history.replaceState(state, '', url);
}

// ---------------------------------------------------------------------------
// Survey pipeline
// ---------------------------------------------------------------------------

async function loadRepo(spec, { view = null, path = null, replaceUrl = false } = {}) {
  const seq = ++app.loadSeq;
  const owner = spec.owner, repoName = spec.repo;
  const label = `${owner}/${repoName}${spec.ref ? `@${spec.ref}` : ''}`;
  const loader = createLoader(STEPS, label);
  let cancelled = false;
  loader.onCancel(() => { cancelled = true; loader.close(); if (!app.ctx) app.hero.show(); });
  const guard = () => { if (cancelled || seq !== app.loadSeq) throw new DOMException('Cancelled', 'AbortError'); };
  const client = app.client;
  hideInspector();
  hideTip();

  try {
    loader.active('repo');
    const meta = await client.getRepo(owner, repoName);
    guard();
    if (typeof meta.description === 'string') meta.description = meta.description.replace(/:[a-z0-9_+-]+:/gi, '').replace(/\s{2,}/g, ' ').trim();
    const ref = spec.ref || meta.default_branch || 'main';
    loader.done('repo', `${fmtCompact(meta.stargazers_count || 0)} ★`);

    loader.active('tree');
    let treeRes;
    try {
      treeRes = await client.getTree(owner, repoName, ref);
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404 && spec.ref) throw new GitHubError(`Branch or ref "${spec.ref}" was not found in ${owner}/${repoName}.`, { status: 404, kind: 'notfound' });
      if (err instanceof GitHubError && err.status === 409) throw new GitHubError('This repository is empty, there is nothing to map yet.', { status: 409, kind: 'empty' });
      throw err;
    }
    guard();
    let entries = Array.isArray(treeRes && treeRes.tree) ? treeRes.tree : [];
    const truncated = !!(treeRes && treeRes.truncated);
    let subPath = spec.path ? spec.path.replace(/^\/+|\/+$/g, '') : null;
    if (subPath) {
      const prefix = `${subPath}/`;
      const inside = entries.filter((e) => e.path.startsWith(prefix)).map((e) => ({ ...e, path: e.path.slice(prefix.length) }));
      if (!inside.length) { toast({ title: 'Folder not found', body: `"${subPath}" is not in this tree, mapping the whole repository instead.`, type: 'warn' }); subPath = null; }
      else entries = inside;
    }
    loader.done('tree', `${fmtInt(entries.filter((e) => e.type === 'blob').length)} files${truncated ? ' · truncated' : ''}`);

    // Optional data. Skip when the anonymous budget is nearly spent.
    const lowBudget = client.rate.remaining !== null && client.rate.remaining < 8 && !client.token;
    let languagesApi = null, contributors = null, commits = null, branches = null, releases = null, commitActivity;
    if (lowBudget) {
      loader.skip('langs', 'low API budget');
      loader.skip('people', 'low API budget');
      toast({ title: 'Running low on anonymous API requests', body: 'Languages, contributors and history were skipped. Add a token in Settings for 5,000 requests per hour.', type: 'warn', timeout: 8000, actions: [{ label: 'Open settings', onClick: () => $('#btn-settings').click() }] });
    } else {
      loader.active('langs');
      const pLang = client.getLanguages(owner, repoName).catch(() => null);
      const pPeople = Promise.allSettled([
        client.getContributors(owner, repoName),
        client.getCommits(owner, repoName, ref),
        client.getBranches(owner, repoName),
        client.getReleases(owner, repoName),
        client.getCommitActivity(owner, repoName),
      ]);
      languagesApi = await pLang;
      guard();
      loader.done('langs', languagesApi ? `${Object.keys(languagesApi).length} languages` : 'unavailable');
      loader.active('people');
      const [c, cm, b, r, a] = await pPeople;
      guard();
      contributors = c.status === 'fulfilled' ? c.value : null;
      commits = cm.status === 'fulfilled' ? cm.value : null;
      branches = b.status === 'fulfilled' ? b.value : null;
      releases = r.status === 'fulfilled' ? r.value : null;
      commitActivity = a.status === 'fulfilled' ? a.value : undefined; // null means GitHub is still computing
      const failed = [c, cm, b, r, a].filter((x) => x.status === 'rejected');
      loader.done('people', failed.length ? `${5 - failed.length} of 5 sources` : `${contributors ? contributors.length : 0}${contributors && contributors.length >= 30 ? '+' : ''} people`);
      const rl = failed.find((x) => x.reason instanceof GitHubError && x.reason.kind === 'ratelimit');
      if (rl) notifyError(rl.reason);
    }

    loader.active('draw');
    await new Promise((r) => setTimeout(r, 30)); // let the loader paint
    const rootName = subPath ? subPath.split('/').pop() : repoName;
    const { root, index } = buildHierarchy(entries, { rootName });
    const stats = computeStats(root);
    const health = healthChecks(index, meta);
    guard();

    const ctx = {
      repo: { owner, repo: repoName, ref, meta, label: `${owner}/${repoName}`, subPath },
      root, index, stats, health, truncated,
      languagesApi, contributors, commitActivity, commits, branches, releases,
      client,
      settings: app.settings,
      state: { path: path || '' },
      cache: {},
      pruned() {
        if (!ctx.cache.pruned || ctx.cache.prunedFor !== app.settings.maxNodes) {
          ctx.cache.pruned = pruneHierarchy(root, { maxNodes: app.settings.maxNodes });
          ctx.cache.prunedFor = app.settings.maxNodes;
        }
        return ctx.cache.pruned;
      },
      select(node) {
        showInspector(node, {
          repo: ctx.repo,
          totalBytes: stats.totalBytes,
          onZoom: (n) => ctx.navigate('treemap', { path: n.path }),
          onOpenFile: (n) => ctx.navigate('explorer', { path: n.path }),
        });
      },
      navigate(viewId, params = {}) {
        if (params.path !== undefined) ctx.state.path = params.path;
        switchView(viewId, { focus: params.path });
      },
      loadRepo: (s) => loadRepo(s),
    };
    app.ctx = ctx;

    loader.done('draw', `${fmtInt(stats.totalFiles + stats.totalDirs)} shapes`);
    showWorkspace(ctx);
    switchView(view && VIEWS.some((v) => v.id === view) ? view : 'overview', { force: true, silent: true });
    writeUrl({ push: !replaceUrl });
    document.title = `${owner}/${repoName} · GitMap`;
    setTimeout(() => loader.close(), 220);
    if (truncated) toast({ title: 'Tree truncated by GitHub', body: 'This repository is larger than the API returns in one listing. Maps cover the first part only.', type: 'warn', timeout: 9000 });
  } catch (err) {
    loader.close();
    if (err && err.name === 'AbortError') return;
    notifyError(err, { onHero: !app.ctx });
    if (!app.ctx) app.hero.show();
  }
}

function notifyError(err, { onHero = false } = {}) {
  const msg = err instanceof GitHubError ? err.message : (err && err.message) || 'Something went wrong.';
  if (err instanceof GitHubError && err.kind === 'ratelimit') {
    const when = err.resetAt ? new Date(err.resetAt) : null;
    const mins = when ? Math.max(1, Math.round((when.getTime() - Date.now()) / 60000)) : null;
    toast({
      title: 'GitHub rate limit reached',
      body: `${msg}${mins ? ` Resets in about ${mins} min (${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).` : ''} A personal access token raises the limit to 5,000 per hour.`,
      type: 'error', timeout: 12000,
      actions: [{ label: 'Add a token', onClick: () => $('#btn-settings').click() }],
    });
  } else {
    toast({ title: onHero ? 'Could not map that repository' : 'Request failed', body: msg, type: 'error', timeout: 8000 });
  }
  if (onHero && app.hero) app.hero.showError(msg);
  console.error(err);
}

// ---------------------------------------------------------------------------
// Workspace chrome
// ---------------------------------------------------------------------------

const ICON_STAR = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/></svg>';
const ICON_FORK = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>';
const ICON_ISSUE = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>';
const ICON_EYE = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"/></svg>';
const ICON_EXPORT = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z"/><path fill="currentColor" d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z"/></svg>';
const ICON_SHARE = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z"/></svg>';

function showWorkspace(ctx) {
  const { meta } = ctx.repo;
  app.hero.hide();
  $('#workspace').hidden = false;
  $('#repo-switcher').hidden = false;
  $('#repo-switch-input').value = `${ctx.repo.owner}/${ctx.repo.repo}${ctx.repo.ref !== meta.default_branch ? `@${ctx.repo.ref}` : ''}`;
  const gh = $('#btn-github');
  gh.href = meta.html_url || `https://github.com/${ctx.repo.owner}/${ctx.repo.repo}`;
  gh.hidden = false;

  const badges = [
    `<span class="repo-badge" title="Mapped ref">${escapeHtml(ctx.repo.ref)}</span>`,
    ctx.repo.subPath ? `<span class="repo-badge" title="Sub-folder">/${escapeHtml(ctx.repo.subPath)}</span>` : '',
    meta.archived ? '<span class="repo-badge" style="color:var(--warn)">archived</span>' : '',
    meta.fork ? '<span class="repo-badge">fork</span>' : '',
    meta.private ? '<span class="repo-badge" style="color:var(--accent-2)">private</span>' : '',
    ctx.truncated ? '<span class="repo-badge" style="color:var(--warn)">truncated</span>' : '',
  ].join('');
  const stat = (icon, value, title) => `<span class="repo-stat" title="${title}">${icon}<strong>${value}</strong></span>`;
  $('#repo-header').innerHTML = `
    <img class="repo-avatar" src="${escapeHtml((meta.owner && meta.owner.avatar_url) || '')}&s=88" alt="" width="44" height="44" />
    <div class="repo-title">
      <div class="repo-name"><a href="${escapeHtml(gh.href)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><span class="owner">${escapeHtml(ctx.repo.owner)}</span>${escapeHtml(ctx.repo.repo)}</a>${badges}</div>
      <div class="repo-desc" title="${escapeHtml(meta.description || '')}">${meta.description ? escapeHtml(meta.description) : '<span class="muted">No description</span>'}</div>
    </div>
    <div class="repo-meta">
      ${stat(ICON_STAR, fmtCompact(meta.stargazers_count || 0), 'Stars')}
      ${stat(ICON_FORK, fmtCompact(meta.forks_count || 0), 'Forks')}
      ${stat(ICON_ISSUE, fmtCompact(meta.open_issues_count || 0), 'Open issues and pull requests')}
      ${stat(ICON_EYE, fmtCompact(meta.subscribers_count || 0), 'Watchers')}
    </div>`;

  renderTabs();
  renderStatus();
}

function renderTabs() {
  const nav = $('#viewtabs');
  nav.innerHTML = '';
  for (const v of VIEWS) {
    const b = el(`<button type="button" class="viewtab${v.id === app.viewId ? ' is-active' : ''}" data-view="${v.id}" role="tab" aria-selected="${v.id === app.viewId}">${v.icon}<span>${escapeHtml(v.label)}</span><kbd>${v.key}</kbd></button>`);
    b.addEventListener('click', () => switchView(v.id));
    nav.appendChild(b);
  }
  nav.appendChild(el('<div class="viewtabs-spacer"></div>'));
  const tools = el(`<div class="tools">
    <button type="button" class="btn btn-sm" data-share title="Copy a link to this map">${ICON_SHARE}<span>Share</span></button>
    <div class="menu-wrap"><button type="button" class="btn btn-sm" data-export aria-haspopup="menu" aria-expanded="false">${ICON_EXPORT}<span>Export</span></button></div>
  </div>`);
  nav.appendChild(tools);
  tools.querySelector('[data-share]').addEventListener('click', async () => {
    writeUrl();
    const ok = await copyText(location.href);
    toast({ title: ok ? 'Link copied' : 'Could not copy', body: ok ? 'Anyone with the link sees this exact view.' : location.href, type: ok ? 'success' : 'error', timeout: 3000 });
  });
  const wrap = tools.querySelector('.menu-wrap');
  const btn = tools.querySelector('[data-export]');
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggleExportMenu(wrap, btn); });
}

function toggleExportMenu(wrap, btn) {
  const existing = wrap.querySelector('.menu');
  if (existing) { existing.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  const svgEl = app.viewInstance && app.viewInstance.svg ? app.viewInstance.svg() : null;
  const ctx = app.ctx;
  const base = `gitmap-${ctx.repo.owner}-${ctx.repo.repo}-${app.viewId}`;
  const menu = el(`<div class="menu" role="menu">
    <div class="menu-label">This view</div>
    <button type="button" data-act="svg" ${svgEl ? '' : 'disabled'}>Download SVG</button>
    <button type="button" data-act="png" ${svgEl ? '' : 'disabled'}>Download PNG (2×)</button>
    <div class="sep"></div>
    <div class="menu-label">Repository</div>
    <button type="button" data-act="json">Export tree + stats as JSON</button>
    <button type="button" data-act="md">Copy folder tree as Markdown</button>
  </div>`);
  wrap.appendChild(menu);
  btn.setAttribute('aria-expanded', 'true');
  const close = () => { menu.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 0);
  menu.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    try {
      if (act.dataset.act === 'svg') { downloadSvg(svgEl, base); toast({ title: 'SVG downloaded', type: 'success', timeout: 2000 }); }
      if (act.dataset.act === 'png') { await downloadPng(svgEl, base, 2); toast({ title: 'PNG downloaded', type: 'success', timeout: 2000 }); }
      if (act.dataset.act === 'json') { downloadJson(exportTreeJson(ctx), `gitmap-${ctx.repo.owner}-${ctx.repo.repo}`); toast({ title: 'JSON exported', type: 'success', timeout: 2000 }); }
      if (act.dataset.act === 'md') { const ok = await copyMarkdownTree(ctx.root, { maxDepth: 3, maxChildren: 25 }); toast({ title: ok ? 'Markdown tree copied' : 'Could not copy', body: ok ? 'Paste it into a README or issue.' : '', type: ok ? 'success' : 'error', timeout: 2500 }); }
    } catch (err) {
      toast({ title: 'Export failed', body: err.message || String(err), type: 'error' });
    }
    close();
  });
}

function renderStatus() {
  const bar = $('#statusbar');
  const ctx = app.ctx;
  const rate = app.client.rate;
  const pct = rate.limit ? Math.max(0, Math.min(1, rate.remaining / rate.limit)) : 1;
  const resetMin = rate.reset ? Math.max(0, Math.round((rate.reset - Date.now()) / 60000)) : null;
  bar.innerHTML = `
    <span class="status-item"><span class="dot${ctx.truncated ? ' warn' : ''}"></span>${escapeHtml(ctx.repo.owner)}/${escapeHtml(ctx.repo.repo)}@${escapeHtml(ctx.repo.ref)}${ctx.repo.subPath ? `/${escapeHtml(ctx.repo.subPath)}` : ''}</span>
    <span class="status-item">${fmtInt(ctx.stats.totalFiles)} files</span>
    <span class="status-item">${fmtInt(ctx.stats.totalDirs)} folders</span>
    <span class="status-item">${fmtBytes(ctx.stats.totalBytes)}</span>
    <span class="status-item">depth ${ctx.stats.maxDepth}</span>
    <span class="spacer"></span>
    <span class="status-item" title="GitHub API budget for this hour">${app.client.token ? 'token' : 'anonymous'} · API ${rate.limit ? `${fmtInt(rate.remaining)}/${fmtInt(rate.limit)}` : '—'}${resetMin !== null ? ` · resets in ${resetMin}m` : ''}<span class="ratebar"><i style="width:${(pct * 100).toFixed(0)}%;background:${pct < 0.15 ? 'var(--bad)' : pct < 0.4 ? 'var(--warn)' : 'var(--accent-2)'}"></i></span></span>`;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function switchView(id, { focus, force = false, silent = false } = {}) {
  const view = VIEWS.find((v) => v.id === id) || VIEWS[0];
  if (!app.ctx) return;
  if (!force && app.viewInstance && app.viewId === view.id) {
    if (focus !== undefined && app.viewInstance.focusPath) app.viewInstance.focusPath(focus);
    writeUrl();
    return;
  }
  hideTip();
  const host = $('#view-root');
  const old = app.viewEl;
  if (app.viewInstance && app.viewInstance.unmount) { try { app.viewInstance.unmount(); } catch (e) { console.warn(e); } }
  if (old) { old.classList.add('is-leaving'); setTimeout(() => old.remove(), 160); }
  const container = el(`<div class="view" data-view="${view.id}"></div>`);
  host.appendChild(container);
  app.viewId = view.id;
  app.viewEl = container;
  try {
    app.viewInstance = view.mount(container, app.ctx);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="empty"><strong>This view could not render</strong><span>${escapeHtml(err.message || String(err))}</span></div>`;
    app.viewInstance = { unmount() {}, svg: () => null };
  }
  $$('#viewtabs .viewtab').forEach((b) => { const on = b.dataset.view === view.id; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
  if (!silent) writeUrl();
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === 'Escape') {
      if (typing) return;
      hideInspector();
      $$('.menu').forEach((m) => m.remove());
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      if (app.ctx && app.viewInstance && app.viewInstance.focusSearch) app.viewInstance.focusSearch();
      else if (app.ctx) $('#repo-switch-input').focus();
      else app.hero.focus();
      return;
    }
    if (e.key === 't' || e.key === 'T') { toggleTheme(); return; }
    if (!app.ctx) return;
    const idx = VIEWS.findIndex((v) => v.key === e.key);
    if (idx >= 0) { switchView(VIEWS[idx].id); return; }
    if (e.key === '[' || e.key === ']') {
      const cur = VIEWS.findIndex((v) => v.id === app.viewId);
      const next = (cur + (e.key === ']' ? 1 : -1) + VIEWS.length) % VIEWS.length;
      switchView(VIEWS[next].id);
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  if (!window.d3) {
    document.body.insertAdjacentHTML('afterbegin', '<div style="padding:24px;font-family:system-ui">GitMap needs D3 from cdn.jsdelivr.net to draw maps. The script could not be loaded, check your connection or content blocker and reload.</div>');
    return;
  }
  loadSettings();
  let storage = null;
  try { storage = window.sessionStorage; } catch { storage = null; }
  app.client = new GitHubClient({ token: app.settings.token || null, storage });
  app.client.onRate(() => { if (app.ctx) renderStatus(); });

  initTheme($('#btn-theme'));
  initSettingsDialog();
  initKeyboard();
  app.hero = initHero({ onSubmit: (parsed) => loadRepo(parsed) });

  $('#repo-switcher').addEventListener('submit', (e) => {
    e.preventDefault();
    const parsed = parseRepoInput($('#repo-switch-input').value);
    if (!parsed) { toast({ title: 'Not a repository', body: 'Use owner/repo or paste a GitHub URL.', type: 'error', timeout: 3000 }); return; }
    loadRepo(parsed);
  });

  window.addEventListener('popstate', () => {
    const u = readUrl();
    if (!u.repo) { location.reload(); return; }
    const parsed = parseRepoInput(u.repo);
    if (!parsed) return;
    const same = app.ctx && app.ctx.repo.owner.toLowerCase() === parsed.owner.toLowerCase() && app.ctx.repo.repo.toLowerCase() === parsed.repo.toLowerCase() && (!u.ref || u.ref === app.ctx.repo.ref) && (u.dir || null) === (app.ctx.repo.subPath || null);
    if (same) { app.ctx.state.path = u.path || ''; switchView(u.view || 'overview', { force: true, silent: true, focus: u.path || '' }); }
    else loadRepo({ ...parsed, ref: u.ref || parsed.ref, path: u.dir }, { view: u.view, path: u.path, replaceUrl: true });
  });

  const u = readUrl();
  if (u.repo) {
    const parsed = parseRepoInput(u.repo);
    if (parsed) {
      app.hero.setValue(u.repo);
      loadRepo({ ...parsed, ref: u.ref || parsed.ref, path: u.dir || parsed.path }, { view: u.view, path: u.path, replaceUrl: true });
    }
  }
  window.gitmap = app;
}

boot();
