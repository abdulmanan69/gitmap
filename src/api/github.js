/**
 * GitHub REST client with caching, rate-limit tracking and friendly errors.
 * `parseRepoInput` is pure; `GitHubClient` needs fetch (browser or Node 18+).
 */

const API = 'https://api.github.com';
const CACHE_TTL = 15 * 60 * 1000;
const CACHE_PREFIX = 'gitmap:cache:';

export class GitHubError extends Error {
  constructor(message, { status, kind, resetAt, url } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.kind = kind || 'http';
    this.resetAt = resetAt;
    this.url = url;
  }
}

/**
 * Accepts: owner/repo, owner/repo@branch, https://github.com/owner/repo[/tree/branch/sub/dir],
 * github.com/owner/repo, git@github.com:owner/repo.git, owner/repo.git
 */
export function parseRepoInput(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let ref = null, path = null;

  const ssh = s.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (ssh) return valid(ssh[1], ssh[2]) ? { owner: ssh[1], repo: ssh[2], ref, path } : null;

  s = s.replace(/^(https?:)?\/\//i, '').replace(/^www\./i, '');
  if (/^github\.com\//i.test(s)) {
    s = s.replace(/^github\.com\//i, '');
    const parts = s.split(/[?#]/)[0].split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0], repo = parts[1].replace(/\.git$/i, '');
    if (parts[2] === 'tree' || parts[2] === 'blob' || parts[2] === 'commits') {
      if (parts[3]) ref = decodeURIComponent(parts[3]);
      if (parts.length > 4) path = parts.slice(4).map(decodeURIComponent).join('/');
    }
    return valid(owner, repo) ? { owner, repo, ref, path } : null;
  }

  const at = s.match(/^([^/\s@]+)\/([^/\s@]+?)(?:\.git)?(?:@([^\s]+))?\/?$/);
  if (at) {
    const owner = at[1], repo = at[2];
    ref = at[3] || null;
    return valid(owner, repo) ? { owner, repo, ref, path } : null;
  }
  return null;
}

function valid(owner, repo) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner) && /^[A-Za-z0-9_.-]+$/.test(repo) && repo !== '.' && repo !== '..';
}

export class GitHubClient {
  constructor({ token = null, storage = null, fetchImpl = null } = {}) {
    this.token = token;
    this.storage = storage;
    this.fetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.memory = new Map();
    this.rate = { limit: null, remaining: null, reset: null };
    this.rateListeners = new Set();
    this.requestCount = 0;
  }

  setToken(token) { this.token = token || null; }

  onRate(fn) { this.rateListeners.add(fn); return () => this.rateListeners.delete(fn); }

  clearCache() {
    this.memory.clear();
    if (!this.storage) return;
    try {
      const keys = [];
      for (let i = 0; i < this.storage.length; i++) { const k = this.storage.key(i); if (k && k.startsWith(CACHE_PREFIX)) keys.push(k); }
      keys.forEach((k) => this.storage.removeItem(k));
    } catch { /* ignore */ }
  }

  headers(extra = {}) {
    const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...extra };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  cacheGet(key) {
    const m = this.memory.get(key);
    if (m && Date.now() - m.t < CACHE_TTL) return m.v;
    if (!this.storage) return undefined;
    try {
      const raw = this.storage.getItem(CACHE_PREFIX + key);
      if (!raw) return undefined;
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t > CACHE_TTL) { this.storage.removeItem(CACHE_PREFIX + key); return undefined; }
      this.memory.set(key, { t, v });
      return v;
    } catch { return undefined; }
  }

  cacheSet(key, v) {
    this.memory.set(key, { t: Date.now(), v });
    if (!this.storage) return;
    try { this.storage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v })); }
    catch { /* quota exceeded or blocked: memory cache still works */ }
  }

  updateRate(res) {
    const limitHeader = res.headers.get('x-ratelimit-limit');
    if (limitHeader === null) return;
    const limit = Number(limitHeader);
    const remaining = Number(res.headers.get('x-ratelimit-remaining'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    this.rate = { limit, remaining, reset: reset ? reset * 1000 : null };
    for (const fn of this.rateListeners) { try { fn(this.rate); } catch { /* listener error */ } }
  }

  /** JSON GET with cache. `retry202` polls endpoints that return 202 while GitHub computes stats. */
  async get(path, { params = null, retry202 = 0, cache = true, signal } = {}) {
    const url = new URL(API + path);
    if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const key = `${this.token ? 'auth' : 'anon'}:${url.toString()}`;
    if (cache) { const hit = this.cacheGet(key); if (hit !== undefined) return hit; }

    let attempt = 0;
    for (;;) {
      this.requestCount++;
      let res;
      try {
        res = await this.fetch(url.toString(), { headers: this.headers(), signal });
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        throw new GitHubError('Network error reaching api.github.com. Check your connection or an ad blocker.', { kind: 'network', url: url.toString() });
      }
      this.updateRate(res);

      if (res.status === 202 && attempt < retry202) {
        attempt++;
        await sleep(1200 * attempt);
        continue;
      }
      if (res.status === 202 || res.status === 204) return null; // still computing / no content

      if (!res.ok) throw await this.toError(res, url.toString());
      const data = await res.json();
      if (cache) this.cacheSet(key, data);
      return data;
    }
  }

  async toError(res, url) {
    let body = null;
    try { body = await res.json(); } catch { /* no body */ }
    const msg = body && body.message ? body.message : `HTTP ${res.status}`;
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (res.status === 403 && remaining === '0') {
      const resetAt = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      return new GitHubError(`GitHub API rate limit reached (${this.rate.limit || 60} requests/hour${this.token ? '' : ' without a token'}).`, { status: 403, kind: 'ratelimit', resetAt, url });
    }
    if (res.status === 403 && /secondary rate limit|abuse/i.test(msg)) {
      return new GitHubError('GitHub asked us to slow down (secondary rate limit). Wait a minute and try again.', { status: 403, kind: 'ratelimit', url });
    }
    if (res.status === 401) return new GitHubError('That token was rejected by GitHub. Check it in Settings.', { status: 401, kind: 'auth', url });
    if (res.status === 404) return new GitHubError('Repository not found. It may be private, renamed, or the branch may not exist.', { status: 404, kind: 'notfound', url });
    if (res.status === 451) return new GitHubError('This repository is unavailable for legal reasons.', { status: 451, kind: 'blocked', url });
    if (res.status === 409 && /empty/i.test(msg)) return new GitHubError('This repository is empty.', { status: 409, kind: 'empty', url });
    return new GitHubError(msg, { status: res.status, url });
  }

  // ---- endpoints -------------------------------------------------------

  getRepo(owner, repo) { return this.get(`/repos/${owner}/${repo}`); }

  getTree(owner, repo, ref) { return this.get(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}`, { params: { recursive: 1 } }); }

  getLanguages(owner, repo) { return this.get(`/repos/${owner}/${repo}/languages`); }

  getContributors(owner, repo, perPage = 30) { return this.get(`/repos/${owner}/${repo}/contributors`, { params: { per_page: perPage } }); }

  getCommitActivity(owner, repo) { return this.get(`/repos/${owner}/${repo}/stats/commit_activity`, { retry202: 2 }); }

  getCommits(owner, repo, sha, perPage = 30) { return this.get(`/repos/${owner}/${repo}/commits`, { params: { sha, per_page: perPage } }); }

  getBranches(owner, repo, perPage = 100) { return this.get(`/repos/${owner}/${repo}/branches`, { params: { per_page: perPage } }); }

  getReleases(owner, repo, perPage = 10) { return this.get(`/repos/${owner}/${repo}/releases`, { params: { per_page: perPage } }); }

  getContent(owner, repo, path, ref) { return this.get(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, { params: { ref } }); }

  rawUrl(owner, repo, ref, path) { return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${encodePath(path)}`; }

  /** Fetch a file's text. Tries raw.githubusercontent.com first (no rate limit), falls back to the contents API. */
  async fetchText(owner, repo, ref, path, { maxBytes = 1_500_000, signal } = {}) {
    const key = `raw:${owner}/${repo}@${ref}:${path}`;
    const hit = this.cacheGet(key);
    if (hit !== undefined) return hit;
    try {
      const res = await this.fetch(this.rawUrl(owner, repo, ref, path), { signal });
      if (res.ok) {
        const len = Number(res.headers.get('content-length'));
        if (len && len > maxBytes) throw new GitHubError(`File is ${Math.round(len / 1024)} KB, larger than the preview limit.`, { kind: 'toolarge' });
        const text = await res.text();
        if (text.length > maxBytes) throw new GitHubError('File is larger than the preview limit.', { kind: 'toolarge' });
        this.cacheSet(key, text);
        return text;
      }
    } catch (err) {
      if (err instanceof GitHubError && err.kind === 'toolarge') throw err;
      if (err && err.name === 'AbortError') throw err;
      // fall through to the contents API (private repos with a token, or raw CDN hiccup)
    }
    const data = await this.getContent(owner, repo, path, ref);
    if (!data || data.type !== 'file') throw new GitHubError('Not a file.', { kind: 'notfile' });
    if (data.encoding !== 'base64' || !data.content) throw new GitHubError('File too large for the contents API preview.', { kind: 'toolarge' });
    const text = decodeBase64Utf8(data.content.replace(/\n/g, ''));
    this.cacheSet(key, text);
    return text;
  }
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function decodeBase64Utf8(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, 'base64').toString('utf8');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
