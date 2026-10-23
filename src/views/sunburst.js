/** Zoomable sunburst: rings are depth, arcs are size, colour is language. */
import { fmtBytes, fmtInt } from '../utils/format.js';
import { languageColor } from '../model/languages.js';
import { ancestorsOf } from '../model/tree.js';
import { bindTip, nodeTip, hideTip } from '../ui/tooltip.js';
import { onResize, debounce, prefersReducedMotion } from '../utils/dom.js';
import { renderCrumbs, renderLegend, fitText, ICONS, emptyState } from './common.js';

const RINGS = 4;

export default {
  id: 'sunburst',
  label: 'Sunburst',
  key: '4',
  icon: ICONS.sunburst,
  mount(container, ctx) {
    const d3 = window.d3;
    container.innerHTML = `
      <div class="view-toolbar">
        <button class="btn btn-icon btn-sm" data-up title="Zoom out one level" aria-label="Zoom out">${ICONS.up}</button>
        <div class="crumbs" data-crumbs></div>
        <div class="spacer"></div>
        <span class="hint" data-note></span>
        <span class="hint">Click an arc to zoom · the centre to go up</span>
      </div>
      <div class="viz" data-viz>
        <svg class="sunburst-svg" data-svg></svg>
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
    if (pruned.prunedCount < fullCount) noteEl.textContent = `Showing ${fmtInt(pruned.prunedCount)} of ${fmtInt(fullCount)} shapes · deeper levels folded`;

    let W = 0, H = 0, radius = 0, root = null, current = null, path = null, label = null, center = null, arc = null, g = null, highlighted = null;

    const hierarchy = d3.hierarchy(pruned).sum((d) => (d.children && d.children.length ? 0 : Math.max(d.size, 1))).sort((a, b) => b.value - a.value);

    function arcVisible(d) { return d.y1 <= RINGS + 1 && d.y0 >= 1 && d.x1 > d.x0; }
    function labelVisible(d) {
      if (!(d.y1 <= RINGS + 1 && d.y0 >= 1 && d.x1 > d.x0)) return false;
      const arcLength = (d.x1 - d.x0) * ((d.y0 + d.y1) / 2) * radius; // px along the ring at mid-radius
      return arcLength > 13 && (d.y1 - d.y0) * radius > 26;
    }
    function labelTransform(d) {
      const x = ((d.x0 + d.x1) / 2) * 180 / Math.PI;
      const y = ((d.y0 + d.y1) / 2) * radius;
      return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
    }
    function opacityFor(d) { return d.children ? 0.95 : 0.72; }
    // Hairline separators only where an arc is wide enough to show them, so clusters of slivers
    // read as colour, not as a smear of outline.
    function strokeFor(c) { return (c.x1 - c.x0) * c.y0 * radius > 5 ? 1 : 0; }
    function targetFor(d, p) {
      return {
        x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        y0: Math.max(0, d.y0 - p.depth),
        y1: Math.max(0, d.y1 - p.depth),
      };
    }

    function layout() {
      const r = vizEl.getBoundingClientRect();
      W = Math.max(10, r.width); H = Math.max(10, r.height);
      radius = Math.min(W, H) / 2 / (RINGS + 1.1);
      svg.attr('viewBox', [-W / 2, -H / 2, W, H]);
      root = d3.partition().size([2 * Math.PI, hierarchy.height + 1])(hierarchy);
      root.each((d) => { d.current = d; });
      arc = d3.arc()
        .startAngle((d) => d.x0).endAngle((d) => d.x1)
        .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.004)).padRadius(radius * 1.5)
        .innerRadius((d) => d.y0 * radius).outerRadius((d) => Math.max(d.y0 * radius, d.y1 * radius - 1.2));
    }

    function draw(p) {
      svg.selectAll('*').remove();
      g = svg.append('g');
      const all = root.descendants().slice(1);
      if (p && p !== root) root.each((d) => { d.current = targetFor(d, p); });

      path = g.append('g').selectAll('path').data(all).join('path')
        .attr('fill', (d) => languageColor(d.data.lang))
        .attr('data-lang', (d) => d.data.lang)
        .attr('fill-opacity', (d) => (arcVisible(d.current) ? opacityFor(d) : 0))
        .attr('pointer-events', (d) => (arcVisible(d.current) ? 'auto' : 'none'))
        .style('stroke-width', (d) => strokeFor(d.current))
        .attr('d', (d) => arc(d.current))
        .on('click', (event, d) => {
          event.stopPropagation();
          ctx.select(d.data);
          if (d.children && d.children.length) clicked(d);
        });
      bindTip(path, (d) => nodeTip(d.data, ctx.stats.totalBytes));

      label = g.append('g').attr('pointer-events', 'none').attr('text-anchor', 'middle').style('user-select', 'none')
        .selectAll('text').data(all).join('text')
        .attr('dy', '0.35em')
        .attr('opacity', (d) => +labelVisible(d.current))
        .attr('transform', (d) => labelTransform(d.current))
        .text((d) => fitText(d.data.name, radius * 0.92, 5.9));

      center = g.append('g').attr('class', 'center').on('click', () => { if (current.parent) clicked(current.parent); });
      center.append('circle').attr('r', radius - 2);
      center.append('text').attr('class', 'c-name').attr('text-anchor', 'middle').attr('dy', '-0.2em');
      center.append('text').attr('class', 'c-size').attr('text-anchor', 'middle').attr('dy', '1.1em');
      center.append('text').attr('class', 'c-hint').attr('text-anchor', 'middle').attr('dy', '2.5em');
      bindTip(center, () => nodeTip(current.data, ctx.stats.totalBytes));
    }

    function updateCenter() {
      center.select('.c-name').text(fitText(current.data.name + (current.depth ? '/' : ''), radius * 1.7, 8.2));
      center.select('.c-size').text(`${fmtBytes(current.value)} · ${fmtInt(current.data.files)} files`);
      center.select('.c-hint').text(current.parent ? 'click to go up' : `${fmtInt(current.data.dirs)} folders`);
    }

    function updateChrome() {
      renderCrumbs(crumbsEl, ancestorsOf(pruned, current.data.path), (n) => { const t = root.descendants().find((d) => d.data.path === n.path); if (t) clicked(t); });
      renderLegend(legendEl, current.data.langBytes, { onHover: (lang) => { highlighted = lang; path.attr('opacity', (d) => (!highlighted || d.data.lang === highlighted ? 1 : 0.15)); } });
      upBtn.disabled = !current.parent;
      updateCenter();
    }

    function clicked(p, { animate = true } = {}) {
      hideTip();
      current = p;
      ctx.state.path = p.data.path;
      root.each((d) => { d.target = targetFor(d, p); });
      updateChrome();
      if (!animate || reduce) {
        root.each((d) => { d.current = d.target; });
        path.attr('fill-opacity', (d) => (arcVisible(d.current) ? opacityFor(d) : 0)).attr('pointer-events', (d) => (arcVisible(d.current) ? 'auto' : 'none')).style('stroke-width', (d) => strokeFor(d.current)).attr('d', (d) => arc(d.current));
        label.attr('opacity', (d) => +labelVisible(d.current)).attr('transform', (d) => labelTransform(d.current));
        return;
      }
      const t = g.transition().duration(760).ease(d3.easeCubicInOut);
      path.transition(t)
        .tween('data', (d) => { const i = d3.interpolate(d.current, d.target); return (tt) => { d.current = i(tt); }; })
        .filter(function (d) { return +this.getAttribute('fill-opacity') || arcVisible(d.target); })
        .attr('fill-opacity', (d) => (arcVisible(d.target) ? opacityFor(d) : 0))
        .attr('pointer-events', (d) => (arcVisible(d.target) ? 'auto' : 'none'))
        .styleTween('stroke-width', (d) => () => String(strokeFor(d.current)))
        .attrTween('d', (d) => () => arc(d.current));
      label.filter(function (d) { return +this.getAttribute('opacity') || labelVisible(d.target); }).transition(t)
        .attr('opacity', (d) => +labelVisible(d.target))
        .attrTween('transform', (d) => () => labelTransform(d.current));
    }

    layout();
    const start = ctx.state.path ? root.descendants().find((d) => d.data.path === ctx.state.path && d.children) : null;
    current = start || root;
    draw(current);
    updateChrome();

    upBtn.addEventListener('click', () => { if (current.parent) clicked(current.parent); });
    const stopResize = onResize(vizEl, debounce(() => {
      const p = current.data.path;
      layout();
      current = root.descendants().find((d) => d.data.path === p) || root;
      draw(current);
      updateChrome();
    }, 120));

    return {
      unmount() { stopResize(); hideTip(); },
      svg: () => svg.node(),
      focusPath(p) { const t = root.descendants().find((d) => d.data.path === p); if (t) clicked(t); },
    };
  },
};
