const KEY = 'gitmap:theme';
const listeners = new Set();

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function setTheme(theme, { persist = true } = {}) {
  document.documentElement.setAttribute('data-theme', theme);
  if (persist) { try { localStorage.setItem(KEY, theme); } catch { /* storage blocked */ } }
  for (const fn of listeners) { try { fn(theme); } catch { /* listener error */ } }
}

export function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme(button) {
  if (button) button.addEventListener('click', toggleTheme);
  // Follow OS changes only while the user has not chosen explicitly.
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  if (mq.addEventListener) {
    mq.addEventListener('change', (e) => {
      let saved = null;
      try { saved = localStorage.getItem(KEY); } catch { /* blocked */ }
      if (!saved) setTheme(e.matches ? 'light' : 'dark', { persist: false });
    });
  }
}

/** Read a CSS custom property from :root (useful for canvas / SVG colours). */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
