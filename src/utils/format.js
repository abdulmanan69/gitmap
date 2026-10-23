/** Number and date formatting helpers. Pure module. */

const nf = typeof Intl !== 'undefined' ? new Intl.NumberFormat('en-US') : null;

export function fmtInt(n) {
  n = Math.round(Number(n) || 0);
  return nf ? nf.format(n) : String(n);
}

export function fmtCompact(n) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  if (a < 1000) return String(n);
  if (a < 1e6) return (n / 1e3).toFixed(a < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'k';
  if (a < 1e9) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
}

export function fmtBytes(b, digits) {
  b = Number(b) || 0;
  if (b < 1024) return `${digits ? b.toFixed(digits) : Math.round(b)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < units.length - 1);
  const d = digits ?? (b < 10 ? 1 : 0);
  return `${b.toFixed(d)} ${units[i]}`;
}

export function fmtPct(x, digits = 1) {
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtRelative(iso, now = Date.now()) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  const s = Math.round((now - t) / 1000);
  const abs = Math.abs(s);
  const fmt = (n, u) => `${n} ${u}${n === 1 ? '' : 's'} ${s >= 0 ? 'ago' : 'from now'}`;
  if (abs < 60) return 'just now';
  if (abs < 3600) return fmt(Math.round(abs / 60), 'minute');
  if (abs < 86400) return fmt(Math.round(abs / 3600), 'hour');
  if (abs < 86400 * 30) return fmt(Math.round(abs / 86400), 'day');
  if (abs < 86400 * 365) return fmt(Math.round(abs / (86400 * 30)), 'month');
  return fmt(Math.round(abs / (86400 * 365)), 'year');
}

export function fmtDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

export function plural(n, word, pluralWord) {
  return `${fmtInt(n)} ${n === 1 ? word : (pluralWord || word + 's')}`;
}

export function truncate(str, max = 60) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
