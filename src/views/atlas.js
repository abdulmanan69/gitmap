/** Atlas: zoomable circle packing. Folders are islands tinted by their dominant language. */
import { fmtBytes, fmtInt } from '../utils/format.js';
import { languageColor } from '../model/languages.js';
import { ancestorsOf } from '../model/tree.js';
import { bindTip, nodeTip, hideTip } from '../ui/tooltip.js';
import { onResize, debounce, prefersReducedMotion } from '../utils/dom.js';
import { renderCrumbs, renderLegend, dirFill, fitText, ICONS, emptyState } from './common.js';

export default {
  id: 'atlas',
  label: 'Atlas',
  key: '3',
  icon: ICONS.atlas,
  mount(container, ctx) {
    const d3 = window.d3;
    container.innerHTML = `
      <div class="view-toolbar">
        <button class="btn btn-icon btn-sm" data-up title="Zoom out one level" aria-label="Zoom out">${ICONS.up}</button>
        <div class="crumbs" data-crumbs></div>
        <div class="spacer"></div>
        <span class="hint" data-note></span>
        <span class="hint">Click an island to zoom · background to zoom out</span>
      </div>
      <div class="viz" data-viz>
        <svg class="atlas-svg" data-svg></svg>
        <div class="legend" data-legend></div>
      </div>`;

    const vizEl = container.querySelector('[data-viz]');
    const crumbsEl = container.querySelector('[data-crumbs]');
    const legendEl = container.querySelector('[data-legend]');
    const noteEl = container.querySelector('[data-note]');
    const upBtn = container.querySelector('[data-up]');
    const svg = d3.select(container.querySelector('[data-svg]'));
    const reduce = prefersReducedMotion();

    const pruned = ctx.pruned();
    if (!pruned.children || !pruned.children.length) {
      vizEl.innerHTML = emptyState('Nothing to draw', 'This repository has no files on this branch.');
      return { unmount() {}, svg: () => null };
    }
    const fullCount = ctx.stats.totalFiles + ctx.stats.totalDirs + 1;
    if (pruned.prunedCount < fullCount) {
      noteEl.textContent = `Showing ${fmtInt(pruned.prunedCount)} of ${fmtInt(fullCount)} shapes · deeper levels folded`;
    }

    let W = 0, H = 0, root = null, focus = null, view = null, node = null, label = null, highlighted = null;

    function layout() {
      const r = vizEl.getBoundingClientRect();
      W = Math.max(10, r.width); H = Math.max(10, r.height);
      svg.attr('viewBox', [0, 0, W, H]);
      const S = Math.min(W, H);
      const pack = d3.pack().size([S, S]).padding((d) => (d.depth === 0 ? 10 : d.depth === 1 ? 5 : 2.5));
      root = pack(d3.hierarchy(pruned).sum((d) => (d.children && d.children.length ? 0 : Math.max(d.size, 1))).sort((a, b) => b.value - a.value));
    }

    function draw() {
      svg.selectAll('*').remove();
      const gRoot = svg.append('g');
      const all = root.descendants().slice(1);
      node = gRoot.append('g').selectAll('circle').data(all).join('circle')
        .attr('class', (d) => `${d.data.type === 'group' ? 'group' : d.data.type === 'dir' ? 'dir' : 'file'}${d.data.collapsed ? ' collapsed' : ''}`)
        .attr('data-lang', (d) => d.data.lang)
        .style('fill', (d) => (d.data.type === 'group' ? null : d.data.type === 'dir' ? dirFill(d.data.lang, d.depth) : languageColor(d.data.lang)))
        .style('fill-opacity', (d) => (d.data.type === 'file' || d.data.type === 'submodule' ? 0.9 : null))
        .on('click', (event, d) => {
          event.stopPropagation();
          ctx.select(d.data);
          if (d.children && d.children.length) { if (focus !== d) zoom(d); }
          else if (d.data.collapsed) ctx.navigate('treemap', { path: d.data.path });
        });
      bindTip(node, (d) => nodeTip(d.data, ctx.stats.totalBytes) + (d.data.collapsed ? '<div class="t-row"><span style="color:var(--accent)">Folded · click to open in Treemap</span></div>' : ''));

      label = gRoot.append('g').selectAll('text').data(all).join('text')
        .attr('class', 'lbl')
        .style('display', 'none');
      label.append('tspan').attr('class', 'n').attr('x', 0).attr('dy', '-0.1em');
      label.append('tspan').attr('class', 'lbl size').attr('x', 0).attr('dy', '1.2em');

      svg.on('click', () => { if (focus && focus.parent) zoom(focus.parent); });
    }

    function zoomTo(v) {
      const k = Math.min(W, H) / v[2];
      view = v;
      const tx = (d) => (d.x - v[0]) * k + W / 2;
      const ty = (d) => (d.y - v[1]) * k + H / 2;
      node.attr('transform', (d) => `translate(${tx(d)},${ty(d)})`).attr('r', (d) => Math.max(0.4, d.r * k));
      label.each(function (d) {
        const show = d.parent === focus && d.r * k > 13;
        const t = d3.select(this);
        if (!show) { t.style('display', 'none'); return; }
        const rk = d.r * k;
        t.style('display', null).attr('transform', `translate(${tx(d)},${ty(d)})`);
        const isDir = d.data.type === 'dir' || d.data.type === 'group';
        t.select('tspan.n').text(fitText(d.data.name + (d.data.type === 'dir' ? '/' : ''), rk * 1.7, 6.4));
        t.select('tspan.size').text(rk > 26 ? fitText(`${fmtBytes(d.value)}${isDir && d.data.files ? ` · ${fmtInt(d.data.files)} files` : ''}`, rk * 1.7, 5.9) : '');
      });
    }

    function zoom(d, { animate = true } = {}) {
      hideTip();
      focus = d;
      ctx.state.path = d.data.path;
      updateChrome();
      const target = [focus.x, focus.y, focus.r * 2.08];
      if (!animate || reduce || !view) { zoomTo(target); return; }
      svg.transition().duration(760).ease(d3.easeCubicInOut)
        .tween('zoom', () => { const i = d3.interpolateZoom(view, target); return (t) => zoomTo(i(t)); });
    }

    function updateChrome() {
      renderCrumbs(crumbsEl, ancestorsOf(pruned, focus.data.path), (n) => { const t = root.descendants().find((d) => d.data.path === n.path); if (t) zoom(t); });
      renderLegend(legendEl, focus.data.langBytes, { onHover: (lang) => { highlighted = lang; node.attr('opacity', (d) => (!highlighted || d.data.lang === highlighted || (d.children && d.children.length) ? 1 : 0.15)); } });
      node.classed('is-focus', (d) => d === focus);
      upBtn.disabled = !focus.parent;
    }

    layout();
    draw();
    const start = ctx.state.path ? root.descendants().find((d) => d.data.path === ctx.state.path && d.children) : null;
    focus = start || root;
    zoom(focus, { animate: false });

    upBtn.addEventListener('click', () => { if (focus.parent) zoom(focus.parent); });
    const stopResize = onResize(vizEl, debounce(() => {
      const path = focus.data.path;
      layout(); draw();
      focus = root.descendants().find((d) => d.data.path === path) || root;
      view = null;
      zoom(focus, { animate: false });
    }, 120));

    return {
      unmount() { stopResize(); hideTip(); },
      svg: () => svg.node(),
      focusPath(path) { const t = root.descendants().find((d) => d.data.path === path); if (t) zoom(t); },
    };
  },
};
