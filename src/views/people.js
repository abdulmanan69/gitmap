/** People & history: contributors, commit activity heatmap, recent commits, branches, releases. */
import { fmtInt, fmtDate, fmtRelative, escapeHtml, plural } from '../utils/format.js';
import { showTip, moveTip, hideTip } from '../ui/tooltip.js';
import { prefersReducedMotion } from '../utils/dom.js';
import { ICONS, card, emptyState } from './common.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default {
  id: 'people',
  label: 'People & history',
  key: '7',
  icon: ICONS.people,
  mount(container, ctx) {
    const d3 = window.d3;
    const reduce = prefersReducedMotion();
    const { repo, contributors, commits, branches, releases } = ctx;
    let activity = ctx.commitActivity;

    const render = () => {
      // ---- activity ----
      let activityHtml;
      if (Array.isArray(activity) && activity.length) {
        const weeks = activity.slice(-52);
        const total = weeks.reduce((s, w) => s + (w.total || 0), 0);
        const busiest = weeks.reduce((b, w) => (w.total > (b ? b.total : -1) ? w : b), null);
        const maxDay = Math.max(1, ...weeks.flatMap((w) => w.days || []));
        const level = (n) => (n <= 0 ? 0 : n <= maxDay * 0.15 ? 1 : n <= maxDay * 0.35 ? 2 : n <= maxDay * 0.6 ? 3 : n <= maxDay * 0.85 ? 4 : 5);
        const firstMonth = weeks.length ? new Date(weeks[0].week * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
        activityHtml = `
          <div class="tiles" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-bottom:14px">
            <div class="tile"><div class="label">Commits, 52 weeks</div><div class="value">${fmtInt(total)}</div></div>
            <div class="tile"><div class="label">Per week</div><div class="value">${(total / 52).toFixed(1)}</div></div>
            <div class="tile"><div class="label">Busiest week</div><div class="value">${fmtInt(busiest ? busiest.total : 0)}</div><div class="sub">${busiest ? fmtDate(new Date(busiest.week * 1000).toISOString()) : ''}</div></div>
            <div class="tile"><div class="label">Quiet weeks</div><div class="value">${fmtInt(weeks.filter((w) => !w.total).length)}</div></div>
          </div>
          <div class="heat">
            <div class="heat-days">${DAYS.map((d, i) => `<span>${i % 2 ? d : ''}</span>`).join('')}</div>
            <div style="min-width:0">
              <div class="heat-grid" data-heat>
                ${weeks.map((w, wi) => (w.days || []).map((n, di) => `<span class="heat-cell" data-l="${level(n)}" style="--i:${wi * 7 + di}" data-n="${n}" data-d="${new Date((w.week + di * 86400) * 1000).toISOString()}"></span>`).join('')).join('')}
              </div>
              <div class="kbd-help" style="justify-content:space-between;margin-top:6px"><span>${escapeHtml(firstMonth)}</span><span>this week</span></div>
            </div>
          </div>
          <div class="heat-legend">less <i style="background:var(--heat-0)"></i><i style="background:var(--heat-1)"></i><i style="background:var(--heat-2)"></i><i style="background:var(--heat-3)"></i><i style="background:var(--heat-4)"></i><i style="background:var(--heat-5)"></i> more</div>
          <svg class="sparkline" data-spark viewBox="0 0 600 70" preserveAspectRatio="none" style="margin-top:12px" aria-label="Weekly commits"></svg>`;
      } else {
        activityHtml = `<div class="empty"><strong>${activity === null ? 'GitHub is still computing this' : 'No activity data'}</strong><span>${activity === null ? 'Statistics for repositories that have not been visited recently take a few seconds to prepare.' : 'Commit statistics were not available for this repository.'}</span><button class="btn btn-sm" data-retry>Try again</button></div>`;
      }

      // ---- contributors ----
      const maxC = contributors && contributors.length ? Math.max(...contributors.map((c) => c.contributions)) : 1;
      const contribHtml = contributors && contributors.length ? `<div class="list">${contributors.slice(0, 30).map((c, i) => `
        <a class="list-row" href="${escapeHtml(c.html_url || `https://github.com/${c.login}`)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;animation:fade-up .4s ${i * 25}ms var(--ease-out) both">
          <img class="avatar" src="${escapeHtml(c.avatar_url)}&s=56" alt="" loading="lazy" width="28" height="28" />
          <span class="grow"><b style="font-weight:500">${escapeHtml(c.login || c.name || 'anonymous')}</b>
            <span style="display:block;height:4px;border-radius:2px;background:var(--line);margin-top:5px;overflow:hidden"><span style="display:block;height:100%;background:var(--accent-2);width:${((c.contributions / maxC) * 100).toFixed(1)}%"></span></span></span>
          <span class="dim">${plural(c.contributions, 'commit')}</span>
        </a>`).join('')}</div>` : emptyState('No contributor data', 'GitHub did not return contributors for this repository.');

      // ---- commits ----
      const commitsHtml = commits && commits.length ? `<div class="list">${commits.slice(0, 30).map((c, i) => {
        const msg = ((c.commit && c.commit.message) || '').split('\n')[0];
        const who = (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || 'unknown';
        const when = (c.commit && c.commit.author && c.commit.author.date) || (c.commit && c.commit.committer && c.commit.committer.date);
        const avatar = c.author && c.author.avatar_url ? `${c.author.avatar_url}&s=56` : '';
        return `<div class="commit-row" style="animation:fade-up .4s ${i * 20}ms var(--ease-out) both">
          ${avatar ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy" width="28" height="28" />` : '<span class="avatar"></span>'}
          <div style="min-width:0"><div class="msg" title="${escapeHtml(msg)}">${escapeHtml(msg)}</div><div class="who">${escapeHtml(who)} · ${fmtRelative(when)}</div></div>
          <a class="sha" href="${escapeHtml(c.html_url)}" target="_blank" rel="noopener">${(c.sha || '').slice(0, 7)}</a>
        </div>`; }).join('')}</div>` : emptyState('No commits loaded', 'Recent commits were not available.');

      // ---- branches ----
      const defaultBranch = repo.meta && repo.meta.default_branch;
      const branchesHtml = branches && branches.length ? `
        <p class="muted" style="margin-bottom:10px;font-size:var(--fs-sm)">${branches.length >= 100 ? '100+ branches' : plural(branches.length, 'branch', 'branches')}. Default is <code>${escapeHtml(defaultBranch || '')}</code>. Click one to map it.</p>
        <div class="topics">${[...branches].sort((a, b) => (b.name === defaultBranch) - (a.name === defaultBranch) || a.name.localeCompare(b.name)).slice(0, 24).map((b) => `<a class="chip${b.name === repo.ref ? ' is-active' : ''}" href="?repo=${encodeURIComponent(`${repo.owner}/${repo.repo}`)}&ref=${encodeURIComponent(b.name)}" data-branch="${escapeHtml(b.name)}" title="Map this branch">${escapeHtml(b.name)}</a>`).join('')}${branches.length > 24 ? `<span class="chip">+${branches.length - 24} more</span>` : ''}</div>`
        : emptyState('No branch data', '');

      // ---- releases ----
      const releasesHtml = releases && releases.length ? `<div class="list">${releases.slice(0, 10).map((r) => `
        <a class="list-row" href="${escapeHtml(r.html_url)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">
          <span class="repo-badge">${escapeHtml(r.tag_name)}</span>
          <span class="grow">${escapeHtml(r.name || r.tag_name)}${r.prerelease ? ' <span class="repo-badge" style="color:var(--warn)">pre</span>' : ''}${r.draft ? ' <span class="repo-badge">draft</span>' : ''}</span>
          <span class="dim">${fmtRelative(r.published_at || r.created_at)}</span>
        </a>`).join('')}</div>` : emptyState('No releases', 'This repository has not published GitHub releases.');

      container.innerHTML = `<div class="view-scroll"><div class="cards">
        ${card({ span: 12, title: 'Commit activity', sub: 'last 52 weeks, default branch', body: activityHtml, i: 0 })}
        ${card({ span: 6, title: 'Top contributors', sub: contributors ? `${contributors.length >= 30 ? 'top 30' : plural(contributors.length, 'person', 'people')} by commits` : '', body: contribHtml, i: 1 })}
        ${card({ span: 6, title: 'Recent commits', sub: `on <code>${escapeHtml(repo.ref)}</code>`, body: commitsHtml, i: 2 })}
        ${card({ span: 6, title: 'Branches', body: branchesHtml, i: 3 })}
        ${card({ span: 6, title: 'Releases', sub: releases && releases.length ? `latest ${Math.min(10, releases.length)}` : '', body: releasesHtml, i: 4 })}
      </div></div>`;

      const heat = container.querySelector('[data-heat]');
      if (heat) {
        heat.addEventListener('mouseover', (e) => {
          const c = e.target.closest('.heat-cell');
          if (!c) return;
          showTip(`<div class="t-title">${plural(Number(c.dataset.n), 'commit')}</div><div class="t-path">${fmtDate(c.dataset.d)}</div>`, e);
        });
        heat.addEventListener('mousemove', moveTip);
        heat.addEventListener('mouseleave', hideTip);
        heat.scrollLeft = heat.scrollWidth;
      }
      const spark = container.querySelector('[data-spark]');
      if (spark && Array.isArray(activity)) {
        const weeks = activity.slice(-52);
        const x = d3.scaleLinear().domain([0, Math.max(1, weeks.length - 1)]).range([4, 596]);
        const y = d3.scaleLinear().domain([0, Math.max(1, d3.max(weeks, (w) => w.total))]).range([64, 6]);
        const area = d3.area().x((w, i) => x(i)).y0(64).y1((w) => y(w.total)).curve(d3.curveMonotoneX);
        const line = d3.line().x((w, i) => x(i)).y((w) => y(w.total)).curve(d3.curveMonotoneX);
        const s = d3.select(spark);
        s.append('path').attr('class', 'area').attr('d', area(weeks));
        const p = s.append('path').attr('class', 'line').attr('d', line(weeks));
        if (!reduce) { const L = p.node().getTotalLength(); p.attr('stroke-dasharray', `${L} ${L}`).attr('stroke-dashoffset', L).transition().duration(1200).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0); }
        const last = weeks[weeks.length - 1];
        s.append('circle').attr('class', 'dot').attr('r', 3.5).attr('cx', x(weeks.length - 1)).attr('cy', y(last.total));
      }
      const retry = container.querySelector('[data-retry]');
      if (retry) retry.addEventListener('click', async () => {
        retry.disabled = true; retry.textContent = 'Asking GitHub…';
        try {
          activity = await ctx.client.get(`/repos/${repo.owner}/${repo.repo}/stats/commit_activity`, { retry202: 3, cache: false });
          ctx.commitActivity = activity;
          render();
        } catch { retry.disabled = false; retry.textContent = 'Try again'; }
      });
      container.querySelectorAll('[data-branch]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ctx.loadRepo({ owner: repo.owner, repo: repo.repo, ref: a.dataset.branch }); }));
    };

    render();
    return { unmount() { hideTip(); }, svg: () => container.querySelector('[data-spark]') };
  },
};
