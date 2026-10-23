import { el } from '../utils/dom.js';
import { escapeHtml } from '../utils/format.js';

/**
 * toast({ title, body, type: 'info'|'success'|'warn'|'error', timeout, actions: [{label, onClick}], html })
 * Returns a dismiss function.
 */
export function toast({ title, body = '', type = 'info', timeout = 6000, actions = [], html = false } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return () => {};
  const node = el(`
    <div class="toast ${type}" role="${type === 'error' ? 'alert' : 'status'}">
      <div class="grow">
        ${title ? `<div class="title">${escapeHtml(title)}</div>` : ''}
        ${body ? `<div class="body">${html ? body : escapeHtml(body)}</div>` : ''}
        ${actions.length ? '<div class="actions" style="margin-top:8px;display:flex;gap:6px"></div>' : ''}
      </div>
      <button class="close" aria-label="Dismiss">×</button>
    </div>`);
  const actionsEl = node.querySelector('.actions');
  let timer = null;
  function dismiss() {
    clearTimeout(timer);
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 160);
  }
  for (const a of actions) {
    const b = el(`<button class="btn btn-sm">${escapeHtml(a.label)}</button>`);
    b.addEventListener('click', () => { if (a.onClick) a.onClick(); dismiss(); });
    actionsEl.appendChild(b);
  }
  node.querySelector('.close').addEventListener('click', dismiss);
  host.appendChild(node);
  while (host.children.length > 4) host.firstElementChild.remove();
  if (timeout > 0) timer = setTimeout(dismiss, timeout);
  return dismiss;
}
