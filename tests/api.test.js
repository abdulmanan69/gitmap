import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoInput, GitHubClient, GitHubError } from '../src/api/github.js';

test('parseRepoInput accepts the common forms', () => {
  assert.deepEqual(parseRepoInput('d3/d3'), { owner: 'd3', repo: 'd3', ref: null, path: null });
  assert.deepEqual(parseRepoInput('  facebook/react.git '), { owner: 'facebook', repo: 'react', ref: null, path: null });
  assert.deepEqual(parseRepoInput('vitejs/vite@main'), { owner: 'vitejs', repo: 'vite', ref: 'main', path: null });
  assert.deepEqual(parseRepoInput('https://github.com/pallets/flask'), { owner: 'pallets', repo: 'flask', ref: null, path: null });
  assert.deepEqual(parseRepoInput('http://www.github.com/pallets/flask/'), { owner: 'pallets', repo: 'flask', ref: null, path: null });
  assert.deepEqual(parseRepoInput('github.com/tokio-rs/tokio/tree/master/tokio/src'), { owner: 'tokio-rs', repo: 'tokio', ref: 'master', path: 'tokio/src' });
  assert.deepEqual(parseRepoInput('https://github.com/a/b/blob/dev/README.md?plain=1#L3'), { owner: 'a', repo: 'b', ref: 'dev', path: 'README.md' });
  assert.deepEqual(parseRepoInput('git@github.com:owner/repo.git'), { owner: 'owner', repo: 'repo', ref: null, path: null });
});

test('parseRepoInput rejects junk', () => {
  assert.equal(parseRepoInput(''), null);
  assert.equal(parseRepoInput('justaword'), null);
  assert.equal(parseRepoInput('https://gitlab.com/a/b'), null);
  assert.equal(parseRepoInput('a/b/c'), null);
  assert.equal(parseRepoInput('-bad/repo'), null);
  assert.equal(parseRepoInput(null), null);
});

function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const r = key ? routes[key] : { status: 404, body: { message: 'Not Found' } };
    const handler = typeof r === 'function' ? r(calls.length) : r;
    const headers = new Map(Object.entries({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '42', 'x-ratelimit-reset': '1700000000', ...(handler.headers || {}) }));
    return {
      ok: handler.status >= 200 && handler.status < 300,
      status: handler.status,
      headers: { get: (h) => (headers.has(h.toLowerCase()) ? headers.get(h.toLowerCase()) : null) },
      json: async () => handler.body,
      text: async () => (typeof handler.body === 'string' ? handler.body : JSON.stringify(handler.body)),
    };
  };
  return { fetchImpl, calls };
}

test('client caches JSON responses and tracks rate limit', async () => {
  const { fetchImpl, calls } = mockFetch({ '/repos/a/b': { status: 200, body: { default_branch: 'main' } } });
  const client = new GitHubClient({ fetchImpl });
  const seen = [];
  client.onRate((r) => seen.push(r));
  const a = await client.getRepo('a', 'b');
  const b = await client.getRepo('a', 'b');
  assert.equal(a.default_branch, 'main');
  assert.equal(b, a);
  assert.equal(calls.length, 1, 'second call served from cache');
  assert.equal(client.rate.remaining, 42);
  assert.equal(client.rate.limit, 60);
  assert.equal(client.rate.reset, 1700000000 * 1000);
  assert.equal(seen.length, 1);
  assert.equal(calls[0].opts.headers.Accept, 'application/vnd.github+json');
  assert.equal(calls[0].opts.headers.Authorization, undefined);
});

test('client sends the token and keys the cache by auth state', async () => {
  const { fetchImpl, calls } = mockFetch({ '/repos/a/b': { status: 200, body: {} } });
  const client = new GitHubClient({ fetchImpl, token: 'ghp_x' });
  await client.getRepo('a', 'b');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer ghp_x');
  client.setToken(null);
  await client.getRepo('a', 'b');
  assert.equal(calls.length, 2, 'anonymous request is not served from the authenticated cache');
});

test('client maps errors to friendly kinds', async () => {
  const { fetchImpl } = mockFetch({
    '/repos/rl/x': { status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0' } },
    '/repos/nf/x': { status: 404, body: { message: 'Not Found' } },
    '/repos/au/x': { status: 401, body: { message: 'Bad credentials' } },
    '/repos/em/x/git/trees': { status: 409, body: { message: 'Git Repository is empty.' } },
  });
  const client = new GitHubClient({ fetchImpl });
  await assert.rejects(client.getRepo('rl', 'x'), (e) => e instanceof GitHubError && e.kind === 'ratelimit' && e.resetAt === 1700000000 * 1000);
  await assert.rejects(client.getRepo('nf', 'x'), (e) => e.kind === 'notfound');
  await assert.rejects(client.getRepo('au', 'x'), (e) => e.kind === 'auth');
  await assert.rejects(client.getTree('em', 'x', 'main'), (e) => e.kind === 'empty');
});

test('client retries 202 responses and gives up with null', async () => {
  const { fetchImpl, calls } = mockFetch({ '/stats/commit_activity': () => ({ status: 202, body: {} }) });
  const client = new GitHubClient({ fetchImpl });
  const t0 = Date.now();
  const res = await client.get('/repos/a/b/stats/commit_activity', { retry202: 1 });
  assert.equal(res, null);
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - t0 >= 1000, 'waited before retrying');
});

test('network failures become GitHubError(network)', async () => {
  const client = new GitHubClient({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(client.getRepo('a', 'b'), (e) => e instanceof GitHubError && e.kind === 'network');
});

test('fetchText uses raw first, then the contents API with base64', async () => {
  const { fetchImpl, calls } = mockFetch({
    'raw.githubusercontent.com/a/b/main/ok.txt': { status: 200, body: 'hello raw', headers: { 'content-length': '9' } },
    'raw.githubusercontent.com/a/b/main/priv.txt': { status: 404, body: '' },
    '/repos/a/b/contents/priv.txt': { status: 200, body: { type: 'file', encoding: 'base64', content: Buffer.from('héllo api').toString('base64') } },
  });
  const client = new GitHubClient({ fetchImpl });
  assert.equal(await client.fetchText('a', 'b', 'main', 'ok.txt'), 'hello raw');
  assert.equal(await client.fetchText('a', 'b', 'main', 'priv.txt'), 'héllo api');
  assert.equal(await client.fetchText('a', 'b', 'main', 'ok.txt'), 'hello raw');
  assert.equal(calls.filter((c) => c.url.includes('ok.txt')).length, 1, 'raw text cached');
  assert.equal(client.rawUrl('a', 'b', 'feat/x', 'dir/a b.txt'), 'https://raw.githubusercontent.com/a/b/feat%2Fx/dir/a%20b.txt');
});

test('fetchText refuses oversized files', async () => {
  const { fetchImpl } = mockFetch({ 'raw.githubusercontent.com': { status: 200, body: 'x'.repeat(50), headers: { 'content-length': '50' } } });
  const client = new GitHubClient({ fetchImpl });
  await assert.rejects(client.fetchText('a', 'b', 'main', 'big.txt', { maxBytes: 10 }), (e) => e.kind === 'toolarge');
});

test('clearCache forgets memory and storage entries', async () => {
  const store = new Map();
  const storage = { get length() { return store.size; }, key: (i) => [...store.keys()][i], getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const { fetchImpl, calls } = mockFetch({ '/repos/a/b': { status: 200, body: {} } });
  const client = new GitHubClient({ fetchImpl, storage });
  await client.getRepo('a', 'b');
  assert.equal(store.size, 1);
  client.clearCache();
  assert.equal(store.size, 0);
  await client.getRepo('a', 'b');
  assert.equal(calls.length, 2);
});
