/** Zoomable treemap: one level at a time, inner structure drawn as hairlines. */
import { fmtBytes, fmtInt } from '../utils/format.js';
import { languageColor } from '../model/languages.js';
import { ancestorsOf, findByPath } from '../model/tree.js';
import { bindTip, nodeTip, hideTip } from '../ui/tooltip.js';
import { onResize, debounce, prefersReducedMotion, contrastInk } from '../utils/dom.js';
import { renderCrumbs, renderLegend, fitText, ICONS, emptyState } from './common.js';

const INNER_MAX = 48;

export default {
  id: 'treemap',
  label: 'Treemap',
  key: '2',
  icon: ICONS.treemap,
  mount(container, ctx) {
    const d3 = window.d3;
    container.innerHTML = `
      <div class="view-toolbar">
        <button class="btn btn-icon btn-sm" data-up title="Zoom out one level" aria-label="Zoom out">${ICONS.up}</button>
        <div class="crumbs" data-crumbs></div>
        <div class="spacer"></div>
        <label class="hint" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-inner checked style="accent-color:var(--accent)"> Inner structure</label>
        <span class="hint">Click a folder to zoom in · a file to inspect</span>
      </div>
      <div class="viz" data-viz>
        <svg class="treemap-svg" data-svg></svg>
        <div class="legend" data-legend></div>
        <div class="scalebar" data-scale><i></i><span></span></div>
      </div>`;

    const vizEl = container.querySelector('[data-viz]');
    const crumbsEl = container.querySelector('[data-crumbs]');
    const legendEl = container.querySelector('[data-legend]');
    const scaleEl = container.querySelector('[data-scale] span');
    const innerToggle = container.querySelector('[data-inner]');
    const upBtn = container.querySelector('[data-up]');
    const svg = d3.select(container.querySelector('[data-svg]'));

    if (!ctx.root.children || !ctx.root.children.length) {
      vizEl.innerHTML = emptyState('Nothing to draw', 'This repository has no files on this branch.');
      return { unmount() {}, svg: () => null };
    }

    const x = d3.scaleLinear(), y = d3.scaleLinear();
    let width = 0, height = 0, hroot = null, current = null, group = null, showInner = true, highlighted = null;
    const reduce = prefersReducedMotion();

    function layout() {
      const r = vizEl.getBoundingClientRect();
      width = Math.max(10, r.width); height = Math.max(10, r.height);
      svg.attr('viewBox', [0, 0, width, height]);
      x.rangeRound([0, width]); y.rangeRound([0, height]);
      const squarify = d3.treemapSquarify.ratio(1.15);
      const tile = (node, x0, y0, x1, y1) => {
        squarify(node, 0, 0, width, height);
        for (const c of node.children) {
          c.x0 = x0 + (c.x0 / width) * (x1 - x0); c.x1 = x0 + (c.x1 / width) * (x1 - x0);
          c.y0 = y0 + (c.y0 / height) * (y1 - y0); c.y1 = y0 + (c.y1 / height) * (y1 - y0);
        }
      };
      hroot = d3.treemap().tile(tile)(
        d3.hierarchy(ctx.root).sum((d) => (d.children && d.children.length ? 0 : Math.max(d.size, 1))).sort((a, b) => b.value - a.value),
      );
    }

    function nodeFor(path) {
      let found = null;
      hroot.each((d) => { if (!found && d.data.path === path) found = d; });
      return found || hroot;
    }

    function fillFor(d) { return languageColor(d.data.lang); }

    function render(g, node) {
      const kids = (node.children || []).filter((d) => d.value > 0);
      const cell = g.selectAll('g.cell').data(kids, (d) => d.data.path).join('g')
        .attr('class', (d) => `cell ${d.children ? 'is-dir' : 'is-file'}`)
        .attr('data-lang', (d) => d.data.lang)
        .on('click', (event, d) => {
          event.stopPropagation();
          ctx.select(d.data);
          if (d.children && d.children.length) zoomTo(d);
        });
      cell.append('rect').attr('class', 'main').attr('rx', 2).attr('fill', fillFor).attr('fill-opacity', (d) => (d.children ? 1 : 0.82));
      cell.filter((d) => d.children).append('g').attr('class', 'inner')
        .each(function (d) {
          const inner = d.children.slice(0, INNER_MAX).filter((c) => c.value > 0);
          d3.select(this).selectAll('rect').data(inner).join('rect');
        });
      cell.append('text').attr('class', (d) => `label name${contrastInk(fillFor(d)) !== '#fff' ? ' dark' : ''}`).attr('x', 7).attr('y', 17);
      cell.append('text').attr('class', (d) => `label dim${contrastInk(fillFor(d)) !== '#fff' ? ' dark' : ''}`).attr('x', 7).attr('y', 32);
      bindTip(cell, (d) => nodeTip(d.data, ctx.stats.totalBytes));
      position(g);
      applyHighlight(g);
    }

    function position(g) {
      const cells = g.selectAll('g.cell');
      const W = (d) => Math.max(0, x(d.x1) - x(d.x0));
      const H = (d) => Math.max(0, y(d.y1) - y(d.y0));
      cells.attr('transform', (d) => `translate(${x(d.x0)},${y(d.y0)})`);
      cells.select('rect.main').attr('width', W).attr('height', H);
      cells.select('g.inner').style('display', showInner ? null : 'none').selectAll('rect')
        .attr('x', function (c) { const d = this.parentNode.parentNode.__data__; return x(c.x0) - x(d.x0) + 1; })
        .attr('y', function (c) { const d = this.parentNode.parentNode.__data__; return y(c.y0) - y(d.y0) + 1; })
        .attr('width', (c) => Math.max(0, x(c.x1) - x(c.x0) - 2))
        .attr('height', (c) => Math.max(0, y(c.y1) - y(c.y0) - 2));
      cells.select('text.name')
        .text((d) => (W(d) > 40 && H(d) > 22 ? fitText(d.data.name + (d.children ? '/' : ''), W(d) - 12, 6.9) : ''))
        .attr('fill-opacity', (d) => (W(d) > 40 && H(d) > 22 ? 1 : 0));
      cells.select('text.dim')
        .text((d) => (W(d) > 70 && H(d) > 40 ? fitText(`${fmtBytes(d.value)}${d.children ? ` · ${fmtInt(d.data.files)} files` : ''}`, W(d) - 12, 6.3) : ''))
        .attr('fill-opacity', (d) => (W(d) > 70 && H(d) > 40 ? 1 : 0));
    }

    function applyHighlight(g) {
      g.selectAll('g.cell').attr('opacity', (d) => (!highlighted || d.data.lang === highlighted ? 1 : 0.2));
    }

    function updateChrome() {
      renderCrumbs(crumbsEl, ancestorsOf(ctx.root, current.data.path), (n) => zoomTo(nodeFor(n.path)));
      renderLegend(legendEl, current.data.langBytes, { onHover: (lang) => { highlighted = lang; applyHighlight(group); } });
      const bytesPerPx = current.value / (width * height);
      scaleEl.textContent = `1 px² ≈ ${fmtBytes(bytesPerPx, bytesPerPx < 10 ? 1 : 0)} · ${fmtInt(current.data.files)} files`;
      upBtn.disabled = !current.parent;
    }

    function zoomTo(target, { animate = true } = {}) {
      if (!target || target === current) return;
      hideTip();
      const descending = target.ancestors().includes(current);
      const group0 = group ? group.attr('pointer-events', 'none') : null;
      const group1 = descending ? svg.append('g') : svg.insert('g', '*');
      group = group1;
      render(group1, target);
      current = target;
      ctx.state.path = target.data.path;
      x.domain([target.x0, target.x1]); y.domain([target.y0, target.y1]);
      updateChrome();
      if (!animate || reduce || !group0) {
        if (group0) group0.remove();
        position(group1);
        return;
      }
      const t = svg.transition().duration(700).ease(d3.easeCubicInOut);
      group0.transition(t).remove().attr('opacity', descending ? 1 : 0).call(position);
      group1.attr('opacity', descending ? 0 : 1).transition(t).attr('opacity', 1).call(position);
    }

    layout();
    const startNode = ctx.state.path ? findByPath(ctx.root, ctx.state.path) : null;
    current = nodeFor(startNode && startNode.type === 'dir' ? startNode.path : '');
    x.domain([current.x0, current.x1]); y.domain([current.y0, current.y1]);
    group = svg.append('g');
    render(group, current);
    updateChrome();

    upBtn.addEventListener('click', () => { if (current.parent) zoomTo(current.parent); });
    svg.on('dblclick', () => { if (current.parent) zoomTo(current.parent); });
    innerToggle.addEventListener('change', () => { showInner = innerToggle.checked; position(group); });

    const stopResize = onResize(vizEl, debounce(() => {
      const path = current.data.path;
      layout();
      current = nodeFor(path);
      x.domain([current.x0, current.x1]); y.domain([current.y0, current.y1]);
      svg.selectAll('g').remove();
      group = svg.append('g');
      render(group, current);
      updateChrome();
    }, 120));

    return {
      unmount() { stopResize(); hideTip(); },
      svg: () => svg.node(),
      focusPath(path) { zoomTo(nodeFor(path)); },
    };
  },
};
