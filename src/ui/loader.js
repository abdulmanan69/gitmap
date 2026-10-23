import { el } from '../utils/dom.js';
import { escapeHtml, fmtDuration } from '../utils/format.js';

/**
 * Full-screen survey progress card.
 * steps: [{ id, label }]
 */
export function createLoader(steps, repoLabel) {
  const host = document.getElementById('loader');
  host.innerHTML = '';
  const card = el(`
    <div class="loader-card">
      <div class="loader-title">
        <div class="loader-ring"><i></i></div>
        <div>
          <h2>Surveying repository</h2>
          <div class="mono">${escapeHtml(repoLabel)}</div>
        </div>
      </div>
      <div class="loader-steps">
        ${steps.map((s) => `<div class="loader-step" data-step="${s.id}"><span class="ico"></span><span class="lbl">${escapeHtml(s.label)}</span><span class="note"></span></div>`).join('')}
      </div>
      <div class="loader-bar"><i></i></div>
      <div class="loader-foot"><span class="elapsed">0.0s</span><button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button></div>
    </div>`);
  host.appendChild(card);
  host.hidden = false;
  host.style.opacity = '';

  const bar = card.querySelector('.loader-bar i');
  const elapsedEl = card.querySelector('.elapsed');
  const started = performance.now();
  const tick = setInterval(() => { elapsedEl.textContent = fmtDuration(performance.now() - started); }, 100);
  let onCancel = null;
  card.querySelector('[data-cancel]').addEventListener('click', () => { if (onCancel) onCancel(); });

  const stepEl = (id) => card.querySelector(`[data-step="${id}"]`);
  const set = (id, cls, note) => {
    const s = stepEl(id);
    if (!s) return;
    s.classList.remove('is-active', 'is-done', 'is-skip', 'is-fail');
    if (cls) s.classList.add(cls);
    if (note !== undefined) s.querySelector('.note').textContent = note;
  };

  let doneCount = 0;
  const bump = () => { doneCount++; bar.style.width = `${Math.min(100, (doneCount / steps.length) * 100)}%`; };
  return {
    active(id, note) { set(id, 'is-active', note); },
    done(id, note) { set(id, 'is-done', note); bump(); },
    skip(id, note) { set(id, 'is-skip', note || 'skipped'); bump(); },
    fail(id, note) { set(id, 'is-fail', note || 'failed'); },
    onCancel(fn) { onCancel = fn; },
    elapsed() { return performance.now() - started; },
    close() {
      clearInterval(tick);
      bar.style.width = '100%';
      host.style.transition = 'opacity 220ms ease';
      host.style.opacity = '0';
      setTimeout(() => { host.hidden = true; host.style.opacity = ''; host.style.transition = ''; host.innerHTML = ''; }, 230);
    },
  };
}
