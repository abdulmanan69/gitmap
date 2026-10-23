/** Overview: tiles, languages, health, territory mini-map, largest items, shape facts, about. */
import { fmtBytes, fmtInt, fmtCompact, fmtPct, fmtDate, fmtRelative, escapeHtml, truncate } from '../utils/format.js';
import { languageColor } from '../model/languages.js';
import { countUp, prefersReducedMotion } from '../utils/dom.js';
import { showTip, moveTip, hideTip } from '../ui/tooltip.js';
import { ICONS, card } from './common.js';

export default {
  id: 'overview',
  label: 'Overview',
  key: '1',
  icon: ICONS.overview,
  mount(container, ctx) {
    const d3 = window.d3;
    const { repo, stats, health, languagesApi, contributors, truncated, root } = ctx;
    const meta = repo.meta || {};
    const reduce = prefersReducedMotion();

    const langSource = (languagesApi && Object.keys(languagesApi).length
      ? Object.entries(languagesApi).map(([lang, bytes]) => ({ lang, bytes }))
      : stats.languages.map((l) => ({ lang: l.lang, bytes: l.bytes }))).sort((a, b) => b.bytes - a.bytes);
    const langTotal = langSource.reduce((s, l) => s + l.bytes, 0) || 1;
    const langTop = langSource.slice(0, 8);
    const langRest = langSource.slice(8).reduce((s, l) => s + l.bytes, 0);
    const codeLangs = stats.languages.filter((l) => !['Other', 'Image', 'Font', 'Media', 'Lockfile', 'License', 'Git', 'Config', 'Text'].includes(l.lang)).length;

    const tiles = [
      { label: 'Files', value: stats.totalFiles, fmt: fmtInt },
      { label: 'Folders', value: stats.totalDirs, fmt: fmtInt },
      { label: 'Tree size', value: stats.totalBytes, fmt: (v) => fmtBytes(v) },
      { label: 'Deepest path', value: stats.maxDepth, fmt: (v) => `${Math.round(v)}`, suffix: 'levels' },
      { label: 'Languages', value: languagesApi && Object.keys(languagesApi).length ? langSource.length : codeLangs, fmt: fmtInt },
      { label: 'Stars', value: meta.stargazers_count || 0, fmt: fmtCompact },
      { label: 'Forks', value: meta.forks_count || 0, fmt: fmtCompact },
      { label: 'Open issues', value: meta.open_issues_count || 0, fmt: fmtCompact },
      { label: 'Contributors', value: contributors ? contributors.length : null, fmt: (v) => (contributors && contributors.length >= 30 ? '30+' : fmtInt(v)) },
      { label: 'Last push', text: fmtRelative(meta.pushed_at), sub: fmtDate(meta.pushed_at) },
    ];

    const tilesHtml = `<div class="tiles">${tiles.map((t, i) => `
      <div class="tile" style="animation:fade-up .5s ${i * 40}ms var(--ease-out) both">
        <div class="label">${t.label}</div>
        <div class="value" data-tile="${i}">${t.text !== undefined ? escapeHtml(t.text) : (t.value === null ? '—' : '0')}${t.suffix ? `<small>${t.suffix}</small>` : ''}</div>
        ${t.sub ? `<div class="sub">${escapeHtml(t.sub)}</div>` : ''}
      </div>`).join('')}</div>`;

    const ringColor = health.score >= 75 ? 'var(--good)' : health.score >= 50 ? 'var(--warn)' : 'var(--bad)';
    const healthHtml = `
      <div class="score-ring">
        <svg viewBox="0 0 92 92" data-ring>
          <circle cx="46" cy="46" r="40" fill="none" stroke="var(--line)" stroke-width="7"/>
          <circle cx="46" cy="46" r="40" fill="none" stroke="${ringColor}" stroke-width="7" stroke-linecap="round" transform="rotate(-90 46 46)" stroke-dasharray="${2 * Math.PI * 40}" stroke-dashoffset="${2 * Math.PI * 40}" data-arc/>
          <text x="46" y="51" text-anchor="middle" style="font-family:var(--font-display);font-weight:700;font-size:22px;fill:var(--ink)" data-score>0</text>
        </svg>
        <div>
          <div class="big">Grade ${health.grade}</div>
          <div class="grade">${health.results.filter((r) => r.ok).length} of ${health.results.length} conventions present</div>
          <div class="grade" style="margin-top:4px">${health.score >= 90 ? 'Exemplary hygiene.' : health.score >= 75 ? 'Solid. A few extras missing.' : health.score >= 50 ? 'Workable, with gaps worth closing.' : 'Many conventions missing.'}</div>
        </div>
      </div>
      <div class="checks" style="margin-top:14px">
        ${[...health.results].sort((a, b) => a.ok - b.ok || b.weight - a.weight).map((r) => `
          <div class="check-row ${r.ok ? 'ok' : 'miss'}" title="${r.ok ? escapeHtml(r.detail) : 'Not found in the tree'}">
            <span class="mark" aria-hidden="true">${r.ok ? '✓' : '×'}</span>
            <span>${escapeHtml(r.label)}</span>
            <span class="detail">${r.ok ? escapeHtml(truncate(r.detail, 40)) : 'missing'}</span>
          </div>`).join('')}
      </div>`;

    const barRows = (items, { name, color, value, pct, attrs }) => `<div class="bars">${items.map((it) => `
      <div class="bar-row${attrs(it) ? ' is-link' : ''}" ${attrs(it)}>
        <span class="name" title="${escapeHtml(name(it))}"><i style="background:${color(it)}"></i>${escapeHtml(name(it))}</span>
        <span class="track"><span class="fill" style="background:${color(it)}" data-w="${(pct(it) * 100).toFixed(1)}"></span></span>
        <span class="val">${value(it)}</span>
      </div>`).join('')}</div>`;

    const maxDir = stats.largestDirs[0]?.size || 1;
    const dirsHtml = stats.largestDirs.length ? barRows(stats.largestDirs.slice(0, 8), {
      name: (d) => d.path, color: (d) => languageColor(d.lang), value: (d) => `${fmtBytes(d.size)} · ${fmtInt(d.files)} files`, pct: (d) => d.size / maxDir,
      attrs: (d) => `data-go="treemap" data-path="${escapeHtml(d.path)}"`,
    }) : '<div class="empty"><strong>No folders</strong></div>';

    const maxFile = stats.largestFiles[0]?.size || 1;
    const filesHtml = barRows(stats.largestFiles.slice(0, 8), {
      name: (f) => f.path, color: (f) => languageColor(f.lang), value: (f) => fmtBytes(f.size), pct: (f) => f.size / maxFile,
      attrs: (f) => `data-go="explorer" data-path="${escapeHtml(f.path)}"`,
    });

    const maxExt = stats.extensions[0]?.count || 1;
    const extHtml = barRows(stats.extensions.slice(0, 8), {
      name: (e) => (e.ext === '(none)' ? 'no extension' : `.${e.ext}`), color: (e) => languageColor(e.lang), value: (e) => `${fmtInt(e.count)} · ${fmtBytes(e.bytes)}`, pct: (e) => e.count / maxExt,
      attrs: () => '',
    });

    const hist = stats.depthHist.slice(1);
    const histMax = Math.max(1, ...hist);
    const shapeHtml = `
      <div style="display:flex;align-items:flex-end;gap:4px;height:70px;margin-bottom:6px">
        ${hist.map((n, i) => `<div title="Level ${i + 1}: ${fmtInt(n)} files" style="flex:1;background:var(--accent-2);border-radius:3px 3px 0 0;height:${Math.max(2, (n / histMax) * 100)}%;opacity:${0.45 + 0.55 * (n / histMax)}"></div>`).join('')}
      </div>
      <div class="kbd-help" style="justify-content:space-between;margin-bottom:12px"><span>level 1</span><span>files per depth</span><span>level ${hist.length}</span></div>
      <dl class="kv">
        <dt>Average file</dt><dd>${fmtBytes(stats.avgFileSize)}</dd>
        <dt>Test files</dt><dd>${fmtInt(stats.testFiles)}</dd>
        <dt>Docs & text</dt><dd>${fmtInt(stats.docFiles)}</dd>
        <dt>Config files</dt><dd>${fmtInt(stats.configFiles)}</dd>
        <dt>Binary assets</dt><dd>${fmtBytes(stats.binaryBytes)}</dd>
        <dt>Empty files</dt><dd>${fmtInt(stats.zeroByte)}</dd>
        <dt>Top-level entries</dt><dd>${fmtInt(root.children.length)}</dd>
        ${stats.deepest ? `<dt>Deepest file</dt><dd title="${escapeHtml(stats.deepest.path)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px">${escapeHtml(stats.deepest.name)}</dd>` : ''}
      </dl>`;

    const homepage = meta.homepage ? (/^https?:/.test(meta.homepage) ? meta.homepage : `https://${meta.homepage}`) : null;
    const license = meta.license?.spdx_id && meta.license.spdx_id !== 'NOASSERTION' ? meta.license.spdx_id : (meta.license?.name || 'none detected');
    const aboutHtml = `
      <div style="display:grid;grid-template-columns:1fr auto;gap:18px;align-items:start">
        <div>
          <p style="color:var(--ink-2);max-width:80ch">${meta.description ? escapeHtml(meta.description) : '<span class="muted">No description set on GitHub.</span>'}</p>
          ${meta.topics && meta.topics.length ? `<div class="topics" style="margin-top:10px">${meta.topics.map((t) => `<span class="topic">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
          ${homepage ? `<p style="margin-top:10px;font-size:var(--fs-sm)"><a href="${escapeHtml(homepage)}" target="_blank" rel="noopener">${escapeHtml(meta.homepage)} ${ICONS.external}</a></p>` : ''}
          <div class="kbd-help" style="margin-top:16px">
            <span><kbd>1</kbd>–<kbd>7</kbd> switch views</span><span><kbd>/</kbd> search</span><span><kbd>Esc</kbd> close details</span><span><kbd>T</kbd> theme</span>
          </div>
        </div>
        <dl class="kv" style="min-width:240px">
          <dt>Default branch</dt><dd class="mono">${escapeHtml(meta.default_branch || repo.ref)}</dd>
          <dt>Mapped ref</dt><dd class="mono">${escapeHtml(repo.ref)}</dd>
          <dt>License</dt><dd>${escapeHtml(license)}</dd>
          <dt>Created</dt><dd>${fmtDate(meta.created_at)}</dd>
          <dt>Last push</dt><dd>${fmtDate(meta.pushed_at)}</dd>
          <dt>Repo on disk</dt><dd title="Size reported by GitHub, including history">${meta.size ? fmtBytes(meta.size * 1024) : '—'}</dd>
          <dt>Watchers</dt><dd>${fmtCompact(meta.subscribers_count || 0)}</dd>
          <dt>Flags</dt><dd>${[meta.archived && 'archived', meta.fork && 'fork', meta.private && 'private', meta.is_template && 'template'].filter(Boolean).join(', ') || 'public'}</dd>
        </dl>
      </div>`;

    const truncatedHtml = truncated ? `
      <div class="truncated-note">
        <span aria-hidden="true">⚠</span>
        <div><b>GitHub truncated this tree.</b> Repositories with more than ~100,000 entries are cut off by the API, so counts and maps cover the first part only. Paste a sub-folder URL (…/tree/branch/path) to map a region in full.</div>
      </div>` : '';

    container.innerHTML = `<div class="view-scroll"><div class="cards">
      ${truncatedHtml}
      ${card({ span: 12, body: tilesHtml, i: 0 })}
      ${card({ span: 7, title: 'Languages', sub: languagesApi ? 'bytes of code, from GitHub' : 'estimated from file extensions', body: '<div class="donut-wrap"><svg viewBox="0 0 180 180" data-donut></svg><div class="bars" data-langbars></div></div>', i: 1 })}
      ${card({ span: 5, title: 'Repository health', sub: 'conventions found in the tree', body: healthHtml, i: 2 })}
      ${card({ span: 6, title: 'Territory', sub: 'top-level entries by size · click to open the treemap', body: '<div class="mini-map" data-minimap><svg viewBox="0 0 600 220" preserveAspectRatio="none"></svg><div class="overlay">Open treemap</div></div>', i: 3 })}
      ${card({ span: 6, title: 'Largest folders', sub: 'click to zoom in', body: dirsHtml, i: 4 })}
      ${card({ span: 4, title: 'Largest files', sub: 'click to preview', body: filesHtml, i: 5 })}
      ${card({ span: 4, title: 'File types', sub: 'by count', body: extHtml, i: 6 })}
      ${card({ span: 4, title: 'Shape', body: shapeHtml, i: 7 })}
      ${card({ span: 12, title: 'About', body: aboutHtml, i: 8 })}
    </div></div>`;

    // Count-ups
    tiles.forEach((t, i) => {
      if (t.text !== undefined || t.value === null) return;
      const el = container.querySelector(`[data-tile="${i}"]`);
      const suffix = t.suffix ? `<small>${t.suffix}</small>` : '';
      if (reduce) { el.innerHTML = `${t.fmt(t.value)}${suffix}`; return; }
      const start = performance.now(), dur = 900;
      const ease = (u) => 1 - Math.pow(1 - u, 3);
      (function frame(now) {
        const u = Math.min(1, (now - start) / dur);
        el.innerHTML = `${t.fmt(t.value * ease(u))}${suffix}`;
        if (u < 1) requestAnimationFrame(frame);
      })(start);
    });

    // Health ring + bars
    requestAnimationFrame(() => {
      const arc = container.querySelector('[data-arc]');
      const C = 2 * Math.PI * 40;
      arc.style.transition = reduce ? 'none' : 'stroke-dashoffset 1.1s var(--ease-out)';
      arc.setAttribute('stroke-dashoffset', C * (1 - health.score / 100));
      countUp(container.querySelector('[data-score]'), health.score, (v) => `${Math.round(v)}`, 1100);
      container.querySelectorAll('.bar-row .fill[data-w]').forEach((f) => { f.style.width = `${f.dataset.w}%`; });
    });

    // Languages donut
    const donut = d3.select(container.querySelector('[data-donut]'));
    const g = donut.append('g').attr('transform', 'translate(90,90)');
    const pie = d3.pie().value((d) => d.bytes).sort(null).padAngle(0.012);
    const arcGen = d3.arc().innerRadius(58).outerRadius(84).cornerRadius(3);
    const data = langRest > 0 ? [...langTop, { lang: 'Other', bytes: langRest, other: true }] : langTop;
    const colorOf = (l) => (l.other ? 'var(--ink-3)' : languageColor(l.lang));
    const arcs = g.selectAll('path').data(pie(data)).join('path')
      .attr('fill', (d) => colorOf(d.data))
      .attr('stroke', 'var(--surface)').attr('stroke-width', 1.5)
      .on('mouseenter', (event, d) => showTip(`<div class="t-title"><i style="background:${colorOf(d.data)}"></i>${escapeHtml(d.data.lang)}</div><div class="t-row"><span>Bytes</span><b>${fmtBytes(d.data.bytes)}</b></div><div class="t-row"><span>Share</span><b>${fmtPct(d.data.bytes / langTotal)}</b></div>`, event))
      .on('mousemove', moveTip).on('mouseleave', hideTip);
    if (reduce) arcs.attr('d', arcGen);
    else arcs.transition().duration(900).ease(d3.easeCubicOut).attrTween('d', (d) => { const i = d3.interpolate({ startAngle: 0, endAngle: 0, padAngle: d.padAngle }, d); return (t) => arcGen(i(t)); });
    g.append('text').attr('class', 'center-num').attr('text-anchor', 'middle').attr('dy', '0.1em').text(langSource.length);
    g.append('text').attr('class', 'center-lbl').attr('text-anchor', 'middle').attr('dy', '1.9em').text(langSource.length === 1 ? 'language' : 'languages');
    container.querySelector('[data-langbars]').innerHTML = data.map((l) => `
      <div class="bar-row"><span class="name"><i style="background:${colorOf(l)}"></i>${escapeHtml(l.lang)}</span>
      <span class="track"><span class="fill" style="background:${colorOf(l)}" data-w="${((l.bytes / langTotal) * 100).toFixed(1)}"></span></span>
      <span class="val">${fmtPct(l.bytes / langTotal)}</span></div>`).join('');
    requestAnimationFrame(() => container.querySelectorAll('[data-langbars] .fill').forEach((f) => { f.style.width = `${f.dataset.w}%`; }));

    // Territory mini-map (top level only)
    const mini = container.querySelector('[data-minimap]');
    const miniSvg = d3.select(mini.querySelector('svg'));
    const shallow = { children: root.children.map((c) => ({ name: c.name, path: c.path, type: c.type, size: Math.max(c.size, 1), lang: c.lang, files: c.type === 'dir' ? c.files : 1 })) };
    const mroot = d3.treemap().size([600, 220]).paddingInner(2).tile(d3.treemapSquarify.ratio(1.3))(d3.hierarchy(shallow).sum((d) => d.size || 0).sort((a, b) => b.value - a.value));
    const cells = miniSvg.selectAll('g').data(mroot.leaves()).join('g').attr('transform', (d) => `translate(${d.x0},${d.y0})`);
    cells.append('rect').attr('width', (d) => Math.max(0, d.x1 - d.x0)).attr('height', (d) => Math.max(0, d.y1 - d.y0)).attr('rx', 2).attr('fill', (d) => languageColor(d.data.lang)).attr('fill-opacity', (d) => (d.data.type === 'dir' ? 0.95 : 0.7))
      .on('mouseenter', (event, d) => showTip(`<div class="t-title"><i style="background:${languageColor(d.data.lang)}"></i>${escapeHtml(d.data.name)}${d.data.type === 'dir' ? '/' : ''}</div><div class="t-row"><span>Size</span><b>${fmtBytes(d.data.size)}</b></div><div class="t-row"><span>Files</span><b>${fmtInt(d.data.files)}</b></div>`, event))
      .on('mousemove', moveTip).on('mouseleave', hideTip)
      .on('click', (event, d) => { event.stopPropagation(); ctx.navigate('treemap', { path: d.data.type === 'dir' ? d.data.path : '' }); });
    cells.filter((d) => d.x1 - d.x0 > 46 && d.y1 - d.y0 > 18).append('text').attr('x', 6).attr('y', 14)
      .style('font-size', '11px').style('font-weight', '600').style('fill', '#fff').style('paint-order', 'stroke').style('stroke', 'rgba(0,0,0,.5)').style('stroke-width', '2.5px').style('pointer-events', 'none')
      .text((d) => truncate(d.data.name, Math.floor((d.x1 - d.x0 - 10) / 6.5)));
    if (!reduce) cells.attr('opacity', 0).transition().delay((d, i) => 150 + i * 25).duration(400).attr('opacity', 1);
    mini.querySelector('.overlay').addEventListener('click', () => ctx.navigate('treemap', { path: '' }));

    container.addEventListener('click', (e) => {
      const row = e.target.closest('[data-go]');
      if (!row) return;
      ctx.navigate(row.dataset.go, { path: row.dataset.path });
    });

    return { unmount() { hideTip(); }, svg: () => container.querySelector('[data-donut]') };
  },
};
