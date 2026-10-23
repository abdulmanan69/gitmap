/** Dependencies: manifests discovered in the tree, parsed and drawn as a constellation. */
import { fmtInt, escapeHtml } from '../utils/format.js';
import { findManifests, parseManifest, ECOSYSTEMS } from '../model/deps.js';
import { showTip, moveTip, hideTip } from '../ui/tooltip.js';
import { onResize, debounce, prefersReducedMotion } from '../utils/dom.js';
import { currentTheme, onThemeChange } from '../ui/theme.js';
import { ICONS, emptyState } from './common.js';

// Categorical palette (validated for CVD separation in adjacent order), light / dark steps.
const SLOTS_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const SLOTS_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const ECO_ORDER = Object.keys(ECOSYSTEMS);
const MAX_DEPS_PER_MANIFEST = 120;

function ecoColor(eco) {
  const slots = currentTheme() === 'light' ? SLOTS_LIGHT : SLOTS_DARK;
  const i = ECO_ORDER.indexOf(eco);
  return slots[(i < 0 ? 7 : i) % slots.length];
}

async function loadDeps(ctx) {
  if (ctx.cache.deps) return ctx.cache.deps;
  const manifests = findManifests([...ctx.index.keys()], { max: 10 });
  const settled = await Promise.allSettled(manifests.map((m) =>
    ctx.client.fetchText(ctx.repo.owner, ctx.repo.repo, ctx.repo.ref, m.path, { maxBytes: 800_000 }).then((text) => parseManifest(m.path, text)),
  ));
  const parsed = settled.map((r, i) => (r.status === 'fulfilled' ? r.value : { path: manifests[i].path, eco: manifests[i].eco, deps: [], error: (r.reason && r.reason.message) || 'Could not load' }));
  ctx.cache.deps = { manifests: parsed, found: manifests.length };
  return ctx.cache.deps;
}

export default {
  id: 'deps',
  label: 'Dependencies',
  key: '6',
  icon: ICONS.deps,
  mount(container, ctx) {
    const d3 = window.d3;
    const reduce = prefersReducedMotion();
    container.innerHTML = `
      <div class="deps">
        <div class="viz" data-viz>
          <div class="view-toolbar" style="position:absolute;left:0;right:0;top:0;border-bottom:0;background:transparent;backdrop-filter:none;pointer-events:none;z-index:2">
            <span class="hint" data-note style="pointer-events:auto">Reading manifests…</span>
            <div class="spacer"></div>
            <span class="hint">Drag to pan · scroll to zoom · click a package to open its registry page</span>
          </div>
          <svg class="deps-svg" data-svg></svg>
        </div>
        <div class="deps-side">
          <div class="view-toolbar"><div class="search" style="flex:1">${ICONS.search}<input class="input" data-filter type="search" placeholder="Filter packages" aria-label="Filter packages" /></div></div>
          <div class="deps-list" data-list><div class="empty"><span class="muted">Loading manifests…</span></div></div>
        </div>
      </div>`;

    const vizEl = container.querySelector('[data-viz]');
    const noteEl = container.querySelector('[data-note]');
    const listEl = container.querySelector('[data-list]');
    const filterEl = container.querySelector('[data-filter]');
    const svg = d3.select(container.querySelector('[data-svg]'));
    let sim = null, nodeSel = null, linkSel = null, graph = null, stopResize = null, offTheme = null, alive = true;

    function buildGraph(data) {
      const nodes = [{ id: 'repo', type: 'center', label: `${ctx.repo.owner}/${ctx.repo.repo}`, r: 22 }];
      const links = [];
      let totalDeps = 0;
      for (const m of data.manifests) {
        const mid = `m:${m.path}`;
        nodes.push({ id: mid, type: 'manifest', label: m.path, eco: m.eco, r: 11 + Math.min(10, Math.sqrt(m.deps.length)), count: m.deps.length, error: m.error });
        links.push({ source: 'repo', target: mid, kind: 'm' });
        const sorted = [...m.deps].sort((a, b) => (b.kind === 'runtime') - (a.kind === 'runtime'));
        const shown = sorted.slice(0, MAX_DEPS_PER_MANIFEST);
        for (const d of shown) {
          const id = `${mid}::${d.name}`;
          nodes.push({ id, type: 'dep', label: d.name, version: d.version, kind: d.kind, eco: m.eco, manifest: m.path, r: d.kind === 'runtime' ? 5.5 : 4 });
          links.push({ source: mid, target: id, kind: 'd' });
          totalDeps++;
        }
        if (sorted.length > shown.length) {
          const id = `${mid}::more`;
          nodes.push({ id, type: 'more', label: `+${sorted.length - shown.length} more`, eco: m.eco, r: 7 });
          links.push({ source: mid, target: id, kind: 'd' });
        }
      }
      return { nodes, links, totalDeps };
    }

    function fillFor(d) { return d.type === 'dep' ? ecoColor(d.eco) : d.type === 'more' ? 'var(--line-strong)' : null; }

    function draw() {
      const r = vizEl.getBoundingClientRect();
      const W = Math.max(10, r.width), H = Math.max(10, r.height);
      svg.attr('viewBox', [0, 0, W, H]);
      svg.selectAll('*').remove();
      const g = svg.append('g');
      const zoom = d3.zoom().scaleExtent([0.3, 4]).on('zoom', (e) => g.attr('transform', e.transform));
      svg.call(zoom).on('dblclick.zoom', null);

      linkSel = g.append('g').selectAll('line').data(graph.links).join('line').attr('class', 'link').attr('stroke-opacity', (d) => (d.kind === 'm' ? 0.9 : 0.5));
      nodeSel = g.append('g').selectAll('g').data(graph.nodes).join('g').attr('class', (d) => `node ${d.type}`)
        .style('cursor', (d) => (d.type === 'dep' || d.type === 'manifest' ? 'pointer' : 'default'))
        .on('mouseenter', (event, d) => {
          if (d.type === 'center') return;
          const rows = d.type === 'dep'
            ? `<div class="t-row"><span>Version</span><b>${escapeHtml(d.version || 'any')}</b></div><div class="t-row"><span>Kind</span><b>${escapeHtml(d.kind)}</b></div><div class="t-row"><span>Manifest</span><b>${escapeHtml(d.manifest)}</b></div>`
            : d.type === 'manifest' ? `<div class="t-row"><span>Packages</span><b>${fmtInt(d.count)}</b></div><div class="t-row"><span>Ecosystem</span><b>${(ECOSYSTEMS[d.eco] || {}).label || d.eco}</b></div>${d.error ? `<div class="t-row"><span style="color:var(--bad)">${escapeHtml(d.error)}</span></div>` : ''}<div class="t-row"><span style="color:var(--ink-3)">Click to open in Explorer</span></div>` : '';
          showTip(`<div class="t-title"><i style="background:${ecoColor(d.eco)}"></i>${escapeHtml(d.label)}</div>${rows}`, event);
          highlight(d);
        })
        .on('mousemove', moveTip)
        .on('mouseleave', () => { hideTip(); highlight(null); })
        .on('click', (event, d) => {
          if (d.type === 'dep') window.open((ECOSYSTEMS[d.eco] && ECOSYSTEMS[d.eco].registry(d.label)) || '#', '_blank', 'noopener');
          if (d.type === 'manifest') ctx.navigate('explorer', { path: d.label });
        })
        .call(d3.drag()
          .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); if (d.type !== 'center') { d.fx = null; d.fy = null; } }));
      nodeSel.append('circle').attr('r', (d) => d.r)
        .style('fill', fillFor)
        .style('fill-opacity', (d) => (d.type === 'dep' && d.kind !== 'runtime' ? 0.55 : 1));
      const showDepLabels = graph.totalDeps <= 160;
      nodeSel.filter((d) => d.type !== 'dep' || showDepLabels).append('text')
        .attr('dy', (d) => (d.type === 'dep' || d.type === 'more' ? d.r + 10 : d.r + 13)).attr('text-anchor', 'middle')
        .text((d) => (d.type === 'manifest' ? d.label.split('/').pop() + (d.label.includes('/') ? ` · ${d.label.split('/').slice(0, -1).join('/')}` : '') : d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label));

      const center = graph.nodes[0];
      center.fx = W / 2; center.fy = H / 2;
      // Manifests sit on a ring around the (fixed) repository node: a radial force does this reliably,
      // whereas a plain link would hand most of its correction to the fixed centre and barely move them.
      const manifestCount = graph.nodes.filter((n) => n.type === 'manifest').length;
      const ring = Math.min(W, H) * (manifestCount === 1 ? 0.2 : 0.3);
      graph.nodes.filter((n) => n.type === 'manifest').forEach((n, i) => {
        const a = (i / manifestCount) * Math.PI * 2 - Math.PI / 2;
        n.x = W / 2 + Math.cos(a) * ring; n.y = H / 2 + Math.sin(a) * ring;
      });
      graph.nodes.filter((n) => n.type === 'dep' || n.type === 'more').forEach((n) => {
        const m = graph.nodes.find((x) => x.id === `m:${n.manifest}`) || center;
        n.x = (m.x || W / 2) + (Math.random() - 0.5) * 80; n.y = (m.y || H / 2) + (Math.random() - 0.5) * 80;
      });
      sim = d3.forceSimulation(graph.nodes)
        .force('link', d3.forceLink(graph.links).id((d) => d.id).distance((l) => (l.kind === 'm' ? ring : 70 + Math.random() * 60)).strength((l) => (l.kind === 'm' ? 0.2 : 0.5)))
        .force('radial', d3.forceRadial(ring, W / 2, H / 2).strength((d) => (d.type === 'manifest' ? 0.9 : 0)))
        .force('charge', d3.forceManyBody().strength((d) => (d.type === 'center' ? -600 : d.type === 'manifest' ? -400 : -70)).distanceMax(380))
        .force('collide', d3.forceCollide().radius((d) => d.r + (d.type === 'dep' ? 14 : 6)).iterations(2))
        .force('x', d3.forceX(W / 2).strength(0.02))
        .force('y', d3.forceY(H / 2).strength(0.02))
        .alphaDecay(reduce ? 0.3 : 0.028)
        .on('tick', () => {
          linkSel.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
          nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`);
        });
      // Warm start: settle most of the layout synchronously so the first frame already reads as a map,
      // then let the remaining energy animate the final positions.
      sim.stop();
      sim.tick(reduce ? 300 : 90);
      sim.on('tick')();
      if (!reduce) sim.alpha(0.35).restart();
    }

    function highlight(d) {
      if (!nodeSel) return;
      if (!d) { nodeSel.classed('is-dim', false); linkSel.attr('stroke-opacity', (l) => (l.kind === 'm' ? 0.9 : 0.5)); return; }
      const keep = new Set([d.id, 'repo']);
      if (d.type === 'manifest') for (const l of graph.links) if (l.source.id === d.id) keep.add(l.target.id);
      if (d.type === 'dep' || d.type === 'more') for (const l of graph.links) if (l.target.id === d.id) keep.add(l.source.id);
      nodeSel.classed('is-dim', (n) => !keep.has(n.id));
      linkSel.attr('stroke-opacity', (l) => (keep.has(l.source.id) && keep.has(l.target.id) ? 0.95 : 0.08));
    }

    function renderList(data, q = '') {
      const tokens = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const match = (name) => tokens.every((t) => name.toLowerCase().includes(t));
      const groups = data.manifests.map((m) => ({ m, deps: m.deps.filter((d) => match(d.name)) })).filter((g) => g.deps.length || !tokens.length);
      if (!groups.length) { listEl.innerHTML = emptyState('No packages match', 'Try a shorter filter.'); return; }
      listEl.innerHTML = groups.map((g) => `
        <div class="dep-group">
          <div class="dep-group-head"><i style="background:${ecoColor(g.m.eco)}"></i><span title="${escapeHtml(g.m.path)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(g.m.path)}</span><span class="n">${fmtInt(g.deps.length)}${g.m.error ? ' · error' : ''}</span></div>
          ${g.m.error ? `<div class="muted" style="padding:4px 10px;font-size:var(--fs-xs)">${escapeHtml(g.m.error)}</div>` : ''}
          ${g.deps.map((d) => `<a class="dep-row" href="${(ECOSYSTEMS[g.m.eco] && ECOSYSTEMS[g.m.eco].registry(d.name)) || '#'}" target="_blank" rel="noopener" data-id="m:${escapeHtml(g.m.path)}::${escapeHtml(d.name)}">
            <span class="nm">${escapeHtml(d.name)}</span>${d.kind !== 'runtime' ? `<span class="kind">${escapeHtml(d.kind)}</span>` : ''}<span class="ver">${escapeHtml(d.version)}</span></a>`).join('')}
        </div>`).join('');
    }

    listEl.addEventListener('mouseover', (e) => {
      const row = e.target.closest('.dep-row');
      if (!row || !graph) return;
      highlight(graph.nodes.find((x) => x.id === row.dataset.id) || null);
    });
    listEl.addEventListener('mouseleave', () => highlight(null));

    loadDeps(ctx).then((data) => {
      if (!alive) return;
      const total = data.manifests.reduce((s, m) => s + m.deps.length, 0);
      if (!data.manifests.length) {
        noteEl.textContent = 'No manifests found';
        const s = vizEl.querySelector('svg'); if (s) s.remove();
        vizEl.insertAdjacentHTML('beforeend', emptyState('No dependency manifests found', 'GitMap looks for package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, Gemfile, composer.json, pom.xml, build.gradle, pubspec.yaml, *.csproj, mix.exs and Package.swift outside vendored folders.'));
        listEl.innerHTML = '';
        return;
      }
      noteEl.textContent = `${fmtInt(total)} packages across ${fmtInt(data.manifests.length)} manifest${data.manifests.length === 1 ? '' : 's'}`;
      graph = buildGraph(data);
      draw();
      renderList(data);
      filterEl.addEventListener('input', debounce(() => renderList(data, filterEl.value), 100));
      stopResize = onResize(vizEl, debounce(() => { if (sim) sim.stop(); draw(); }, 200));
      offTheme = onThemeChange(() => { if (nodeSel) nodeSel.select('circle').style('fill', fillFor); renderList(data, filterEl.value); });
    }).catch((err) => {
      if (!alive) return;
      noteEl.textContent = 'Could not read manifests';
      listEl.innerHTML = emptyState('Could not read manifests', escapeHtml(err.message || String(err)));
    });

    return {
      unmount() { alive = false; if (sim) sim.stop(); if (stopResize) stopResize(); if (offTheme) offTheme(); hideTip(); },
      svg: () => svg.node(),
      focusSearch() { filterEl.focus(); },
    };
  },
};
