/**
 * Landing hero: animated "islands" canvas (a synthetic repository rendered as circle packing)
 * plus the repository input form.
 */
import { $, $$, prefersReducedMotion } from '../utils/dom.js';
import { parseRepoInput } from '../api/github.js';
import { cssVar, onThemeChange } from './theme.js';

const PALETTE = ['#f1e05a', '#3178c6', '#3572A5', '#dea584', '#00ADD8', '#e34c26', '#663399', '#41b883', '#5fd3c2'];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genTree(rng, depth = 0, langHint = null) {
  const node = { depth, children: [] };
  const breadth = depth === 0 ? 11 : depth === 1 ? 4 + Math.floor(rng() * 6) : 2 + Math.floor(rng() * 6);
  const lang = langHint ?? Math.floor(rng() * PALETTE.length);
  for (let i = 0; i < breadth; i++) {
    const makeDir = depth < 4 && rng() < (depth === 0 ? 0.92 : depth === 1 ? 0.55 : 0.3);
    if (makeDir) node.children.push(genTree(rng, depth + 1, rng() < 0.75 ? lang : Math.floor(rng() * PALETTE.length)));
    else node.children.push({ depth: depth + 1, size: Math.exp(rng() * 3.2) * 4 + 2, lang: rng() < 0.8 ? lang : Math.floor(rng() * PALETTE.length), phase: rng() * Math.PI * 2 });
  }
  if (depth > 0 && !node.children.length) node.children.push({ depth: depth + 1, size: 6, lang, phase: 0 });
  return node;
}

export function initHero({ onSubmit }) {
  const hero = $('#hero');
  const form = $('#hero-form');
  const input = $('#hero-input');
  const wrap = $('.hero-input-wrap', hero);
  const hint = $('#hero-hint');
  const defaultHint = hint.innerHTML;

  function showError(msg) {
    wrap.classList.add('is-invalid');
    hint.classList.add('is-error');
    hint.textContent = msg;
  }
  function clearError() {
    wrap.classList.remove('is-invalid');
    hint.classList.remove('is-error');
    hint.innerHTML = defaultHint;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const parsed = parseRepoInput(input.value);
    if (!parsed) { showError('That does not look like a GitHub repository. Try owner/repo or paste the URL.'); input.focus(); return; }
    clearError();
    onSubmit(parsed, input.value);
  });
  input.addEventListener('input', () => { if (wrap.classList.contains('is-invalid')) clearError(); });

  for (const chip of $$('.chip[data-repo]', hero)) {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.repo;
      clearError();
      onSubmit(parseRepoInput(chip.dataset.repo), chip.dataset.repo);
    });
  }

  const islands = startIslands($('#hero-canvas'));
  return {
    setValue(v) { input.value = v; },
    focus() { input.focus(); },
    showError,
    hide() {
      hero.classList.add('is-leaving');
      setTimeout(() => { hero.hidden = true; hero.classList.remove('is-leaving'); islands.pause(); }, 480);
    },
    show() {
      hero.hidden = false;
      islands.resume();
      input.focus();
    },
    destroy() { islands.stop(); },
  };
}

function startIslands(canvas) {
  if (!canvas || !window.d3) return { pause() {}, resume() {}, stop() {} };
  const d3 = window.d3;
  const ctx = canvas.getContext('2d');
  const reduce = prefersReducedMotion();
  const rng = mulberry32(20231);
  const data = genTree(rng);
  let nodes = [];
  let W = 0, H = 0, dpr = 1;
  let raf = 0, paused = false, stopped = false;
  let mouse = { x: 0.5, y: 0.5 };
  const smooth = { x: 0.5, y: 0.5 };
  let lineColor = cssVar('--line-strong') || 'rgba(156,170,220,0.3)';
  let accent = cssVar('--accent') || '#f2a93b';
  let isLight = document.documentElement.getAttribute('data-theme') === 'light';

  onThemeChange(() => {
    lineColor = cssVar('--line-strong'); accent = cssVar('--accent');
    isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (reduce) draw(0);
  });

  function layout() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, rect.width); H = Math.max(1, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const size = Math.max(W, H) * 1.15;
    const pack = d3.pack().size([size, size]).padding((d) => (d.depth === 0 ? 24 : d.depth === 1 ? 10 : 4));
    const root = pack(d3.hierarchy(data).sum((d) => d.size || 0).sort((a, b) => b.value - a.value));
    const ox = (W - size) / 2, oy = (H - size) / 2 + H * 0.04;
    const r2 = mulberry32(99);
    nodes = root.descendants().filter((d) => d.depth > 0).map((d) => ({
      x: d.x + ox, y: d.y + oy, r: d.r, depth: d.depth, leaf: !d.children,
      lang: d.data.lang ?? 0, phase: d.data.phase ?? 0, dirPhase: r2() * 6.28,
    }));
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    smooth.x += (mouse.x - smooth.x) * 0.04;
    smooth.y += (mouse.y - smooth.y) * 0.04;
    const px = (smooth.x - 0.5) * 26, py = (smooth.y - 0.5) * 18;
    const breathe = reduce ? 0 : Math.sin(t / 2600) * 0.012;
    ctx.save();
    ctx.translate(W / 2 + px, H / 2 + py);
    ctx.scale(1 + breathe, 1 + breathe);
    ctx.translate(-W / 2, -H / 2);

    // directories: hairline rings, like contour lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = lineColor;
    for (const n of nodes) {
      if (n.leaf) continue;
      const wob = reduce ? 0 : Math.sin(t / 1800 + n.dirPhase) * (n.depth === 1 ? 2.2 : 1.1);
      ctx.globalAlpha = n.depth === 1 ? 0.9 : 0.6;
      ctx.beginPath();
      ctx.arc(n.x, n.y, Math.max(1, n.r + wob), 0, Math.PI * 2);
      ctx.stroke();
      if (n.depth === 1) {
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(1, n.r + wob - 6), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // files: filled dots in language colours, with a slow pulse
    ctx.globalAlpha = isLight ? 0.42 : 0.38;
    for (const n of nodes) {
      if (!n.leaf) continue;
      const pulse = reduce ? 1 : 1 + Math.sin(t / 1400 + n.phase) * 0.08;
      ctx.beginPath();
      ctx.arc(n.x, n.y, Math.max(0.6, n.r * 0.86 * pulse), 0, Math.PI * 2);
      ctx.fillStyle = PALETTE[n.lang % PALETTE.length];
      ctx.fill();
    }
    // the surveyor's marker: one amber dot drifting between islands
    if (!reduce && nodes.length) {
      const k = (t / 9000) % 1;
      const dirs = nodes.filter((n) => !n.leaf && n.depth === 1);
      if (dirs.length > 1) {
        const i = Math.floor(k * dirs.length), j = (i + 1) % dirs.length;
        const f = (k * dirs.length) % 1, e = f < 0.5 ? 2 * f * f : -1 + (4 - 2 * f) * f;
        const x = dirs[i].x + (dirs[j].x - dirs[i].x) * e, y = dirs[i].y + (dirs[j].y - dirs[i].y) * e;
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
        ctx.globalAlpha = 0.25;
        ctx.beginPath(); ctx.arc(x, y, 10 + Math.sin(t / 300) * 2, 0, Math.PI * 2); ctx.strokeStyle = accent; ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function loop(t) {
    if (stopped) return;
    if (!paused) draw(t);
    raf = requestAnimationFrame(loop);
  }

  layout();
  if (reduce) draw(0); else raf = requestAnimationFrame(loop);

  const onMove = (e) => { mouse = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight }; };
  const onResize = () => { if (!paused) { layout(); if (reduce) draw(0); } };
  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('resize', onResize);

  return {
    pause() { paused = true; },
    resume() { paused = false; layout(); if (reduce) draw(0); },
    stop() { stopped = true; cancelAnimationFrame(raf); window.removeEventListener('mousemove', onMove); window.removeEventListener('resize', onResize); },
  };
}
