/**
 * Builds and analyses the repository hierarchy from the flat GitHub tree listing.
 * Pure module: no DOM, safe to import in Node tests.
 *
 * Node shape:
 *   { name, path, type: 'dir'|'file'|'submodule'|'group', size, children?, files, dirs, depth, ext?, lang, langBytes?, sha?, mode?, count? }
 */

import { detectLanguage, extOf } from './languages.js';

export function buildHierarchy(entries, { rootName = 'root' } = {}) {
  const root = mkDir(rootName, '', 0);
  const index = new Map([['', root]]);

  function getDir(path) {
    let node = index.get(path);
    if (node) return node;
    const i = path.lastIndexOf('/');
    const parentPath = i === -1 ? '' : path.slice(0, i);
    const parent = getDir(parentPath);
    node = mkDir(path.slice(i + 1), path, parent.depth + 1);
    parent.children.push(node);
    index.set(path, node);
    return node;
  }

  for (const e of entries) {
    if (!e || typeof e.path !== 'string') continue;
    if (e.type === 'tree') { getDir(e.path); continue; }
    if (e.type !== 'blob' && e.type !== 'commit') continue;
    const i = e.path.lastIndexOf('/');
    const dir = getDir(i === -1 ? '' : e.path.slice(0, i));
    const name = e.path.slice(i + 1);
    const isSub = e.type === 'commit';
    const node = {
      name,
      path: e.path,
      type: isSub ? 'submodule' : 'file',
      size: Number(e.size) || 0,
      sha: e.sha,
      mode: e.mode,
      depth: dir.depth + 1,
      ext: extOf(name),
      lang: isSub ? 'Git' : detectLanguage(name),
    };
    dir.children.push(node);
    index.set(e.path, node);
  }

  aggregate(root);
  return { root, index };
}

function mkDir(name, path, depth) {
  return { name, path, type: 'dir', size: 0, children: [], files: 0, dirs: 0, depth, lang: 'Other', langBytes: null, maxDepth: depth };
}

function aggregate(node) {
  if (node.type !== 'dir') return;
  let size = 0, files = 0, dirs = 0, maxDepth = node.depth;
  const langBytes = new Map();
  for (const c of node.children) {
    if (c.type === 'dir') {
      aggregate(c);
      size += c.size; files += c.files; dirs += 1 + c.dirs;
      if (c.maxDepth > maxDepth) maxDepth = c.maxDepth;
      for (const [l, b] of c.langBytes) langBytes.set(l, (langBytes.get(l) || 0) + b);
    } else {
      size += c.size; files += 1;
      if (c.depth > maxDepth) maxDepth = c.depth;
      langBytes.set(c.lang, (langBytes.get(c.lang) || 0) + Math.max(c.size, 1));
    }
  }
  node.size = size; node.files = files; node.dirs = dirs; node.maxDepth = maxDepth; node.langBytes = langBytes;
  node.lang = dominantLanguage(langBytes);
  node.children.sort((a, b) => (b.type === 'dir') - (a.type === 'dir') || b.size - a.size || a.name.localeCompare(b.name));
}

const NON_CODE = new Set(['Image', 'Font', 'Media', 'Lockfile', 'Other', 'JSON', 'Text', 'Markdown', 'License', 'Config', 'Git', 'CSV', 'YAML', 'XML']);

/** Prefer real code languages when choosing a directory's dominant colour. */
export function dominantLanguage(langBytes) {
  let best = 'Other', bestBytes = -1, bestCode = 'Other', bestCodeBytes = -1;
  for (const [l, b] of langBytes) {
    if (b > bestBytes) { best = l; bestBytes = b; }
    if (!NON_CODE.has(l) && b > bestCodeBytes) { bestCode = l; bestCodeBytes = b; }
  }
  return bestCodeBytes > 0 ? bestCode : best;
}

/** Walk every node depth-first. */
export function walk(node, fn, parent = null) {
  fn(node, parent);
  if (node.children) for (const c of node.children) walk(c, fn, node);
}

export function computeStats(root) {
  const ext = new Map();
  const langs = new Map();
  const files = [];
  const dirs = [];
  let maxDepth = 0, deepest = null, testFiles = 0, docFiles = 0, configFiles = 0, binaryBytes = 0, zeroByte = 0;

  walk(root, (n) => {
    if (n.type === 'dir') { if (n.path) dirs.push(n); return; }
    files.push(n);
    if (n.depth > maxDepth) { maxDepth = n.depth; deepest = n; }
    const e = n.ext || '(none)';
    const er = ext.get(e) || { ext: e, count: 0, bytes: 0, lang: n.lang };
    er.count++; er.bytes += n.size; ext.set(e, er);
    const lr = langs.get(n.lang) || { lang: n.lang, files: 0, bytes: 0 };
    lr.files++; lr.bytes += n.size; langs.set(n.lang, lr);
    if (/(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|playwright)(\/|$)/i.test(n.path) || /\.(test|spec)\.[a-z]+$/i.test(n.name) || /_test\.go$|^test_.*\.py$|_test\.py$|_spec\.rb$/i.test(n.name)) testFiles++;
    if (n.lang === 'Markdown' || n.lang === 'reStructuredText' || n.lang === 'Text' || /(^|\/)docs?(\/|$)/i.test(n.path)) docFiles++;
    if (['Config', 'YAML', 'TOML', 'JSON', 'Git'].includes(n.lang)) configFiles++;
    if (['Image', 'Font', 'Media', 'WebAssembly'].includes(n.lang)) binaryBytes += n.size;
    if (n.size === 0 && n.type === 'file') zeroByte++;
  });

  const extensions = [...ext.values()].sort((a, b) => b.count - a.count);
  const languages = [...langs.values()].sort((a, b) => b.bytes - a.bytes);
  const largestFiles = [...files].sort((a, b) => b.size - a.size).slice(0, 15);
  const largestDirs = [...dirs].sort((a, b) => b.size - a.size).slice(0, 12);
  const busiestDirs = [...dirs].filter((d) => d.children.some((c) => c.type !== 'dir')).sort((a, b) => b.children.length - a.children.length).slice(0, 8);
  const depthHist = [];
  for (const f of files) depthHist[f.depth] = (depthHist[f.depth] || 0) + 1;

  return {
    totalFiles: files.length,
    totalDirs: dirs.length,
    totalBytes: root.size,
    avgFileSize: files.length ? root.size / files.length : 0,
    maxDepth,
    deepest,
    extensions,
    languages,
    largestFiles,
    largestDirs,
    busiestDirs,
    depthHist: Array.from(depthHist, (v) => v || 0),
    testFiles,
    docFiles,
    configFiles,
    binaryBytes,
    zeroByte,
    topLevel: root.children.map((c) => ({ name: c.name, type: c.type, size: c.size, files: c.type === 'dir' ? c.files : 1 })),
  };
}

/**
 * Produce a reduced copy of the hierarchy that has at most ~maxNodes nodes.
 * Strategy: cap depth so the cumulative node count fits, then within each directory
 * fold the smallest files beyond `maxChildren` into a single "+N more" group node.
 */
export function pruneHierarchy(root, { maxNodes = 2500, maxChildren = 48 } = {}) {
  // Count shapes per depth as they would appear after folding crowded folders.
  const perDepth = [];
  perDepth[root.depth] = 1;
  walk(root, (n) => {
    if (n.type !== 'dir') return;
    let dirs = 0, files = 0;
    for (const c of n.children) { if (c.type === 'dir') dirs++; else files++; }
    perDepth[n.depth + 1] = (perDepth[n.depth + 1] || 0) + dirs + Math.min(files, maxChildren);
  });
  let cum = 0, depthCap = root.depth;
  for (let d = root.depth; d < perDepth.length; d++) {
    cum += perDepth[d] || 0;
    if (cum > maxNodes && d > root.depth + 1) break;
    depthCap = d;
  }

  let total = 0;
  function clone(n) {
    total++;
    if (n.type !== 'dir') return { ...n };
    const out = { ...n, children: [], langBytes: n.langBytes };
    if (n.depth >= depthCap) { out.collapsed = true; return out; }
    const dirs = n.children.filter((c) => c.type === 'dir');
    const files = n.children.filter((c) => c.type !== 'dir');
    for (const d of dirs) out.children.push(clone(d));
    if (files.length > maxChildren) {
      const keep = files.slice(0, maxChildren - 1);
      const rest = files.slice(maxChildren - 1);
      for (const f of keep) out.children.push(clone(f));
      total++;
      const restLang = new Map();
      for (const f of rest) restLang.set(f.lang, (restLang.get(f.lang) || 0) + Math.max(f.size, 1));
      out.children.push({
        name: `+${rest.length} more files`,
        path: n.path ? `${n.path}/…` : '…',
        type: 'group',
        size: rest.reduce((s, f) => s + f.size, 0),
        count: rest.length,
        depth: n.depth + 1,
        lang: dominantLanguage(restLang),
        items: rest,
      });
    } else {
      for (const f of files) out.children.push(clone(f));
    }
    return out;
  }
  const pruned = clone(root);
  pruned.prunedTo = depthCap;
  pruned.prunedCount = total;
  return pruned;
}

/** Find a node by path in the hierarchy (works on pruned copies too). */
export function findByPath(root, path) {
  if (!path) return root;
  const parts = path.split('/');
  let node = root;
  for (const p of parts) {
    if (!node.children) return null;
    node = node.children.find((c) => c.name === p);
    if (!node) return null;
  }
  return node;
}

/** Ancestors from root to node (inclusive), by path. */
export function ancestorsOf(root, path) {
  const out = [root];
  if (!path) return out;
  let node = root;
  for (const p of path.split('/')) {
    node = node.children?.find((c) => c.name === p);
    if (!node) break;
    out.push(node);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Repository health checks
// ---------------------------------------------------------------------------

const CHECKS = [
  { id: 'readme', label: 'README', weight: 10, test: (idx) => firstMatch(idx, /^readme(\.|$)/i) },
  { id: 'license', label: 'License file', weight: 10, test: (idx) => firstMatch(idx, /^(license|licence|copying)(\.|$)/i) },
  { id: 'gitignore', label: '.gitignore', weight: 4, test: (idx) => (idx.has('.gitignore') ? '.gitignore' : null) },
  { id: 'ci', label: 'CI workflows', weight: 10, test: (idx) => firstMatch(idx, /^\.github\/workflows\/.+\.ya?ml$/i) || firstMatch(idx, /^(\.gitlab-ci\.yml|\.circleci\/config\.yml|\.travis\.yml|azure-pipelines\.yml|Jenkinsfile|bitbucket-pipelines\.yml)$/i) },
  { id: 'tests', label: 'Tests', weight: 12, test: (idx) => firstMatch(idx, /(^|\/)(tests?|__tests__|spec|specs|e2e)\/[^/]+/i) || firstMatch(idx, /\.(test|spec)\.[a-z]+$|_test\.go$|^test_.*\.py$|_spec\.rb$/i) },
  { id: 'contributing', label: 'Contributing guide', weight: 6, test: (idx) => firstMatch(idx, /^(\.github\/)?contributing(\.|$)/i) },
  { id: 'coc', label: 'Code of conduct', weight: 4, test: (idx) => firstMatch(idx, /^(\.github\/)?code[-_]of[-_]conduct(\.|$)/i) },
  { id: 'security', label: 'Security policy', weight: 5, test: (idx) => firstMatch(idx, /^(\.github\/)?security(\.md|\.txt|$)/i) },
  { id: 'changelog', label: 'Changelog', weight: 4, test: (idx) => firstMatch(idx, /^(changelog|changes|history|releases)(\.|$)/i) },
  { id: 'docs', label: 'Docs folder', weight: 5, test: (idx) => firstMatch(idx, /^docs?\/[^/]+/i) },
  { id: 'manifest', label: 'Dependency manifest', weight: 6, test: (idx) => firstMatch(idx, /^(package\.json|requirements.*\.txt|pyproject\.toml|Pipfile|go\.mod|Cargo\.toml|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|pubspec\.yaml|mix\.exs|Package\.swift|[^/]+\.csproj|deno\.json)$/i) },
  { id: 'lockfile', label: 'Lockfile committed', weight: 4, test: (idx) => firstMatch(idx, /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum|pubspec\.lock|flake\.lock|uv\.lock)$/i) },
  { id: 'docker', label: 'Container setup', weight: 3, test: (idx) => firstMatch(idx, /^(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml|\.devcontainer\/)/i) },
  { id: 'editorconfig', label: 'Editor / formatter config', weight: 3, test: (idx) => firstMatch(idx, /^(\.editorconfig|\.prettierrc|prettier\.config\.|\.eslintrc|eslint\.config\.|biome\.json|\.rubocop\.yml|rustfmt\.toml|\.clang-format|ruff\.toml|setup\.cfg|\.flake8)/i) },
  { id: 'codeowners', label: 'CODEOWNERS', weight: 4, test: (idx) => firstMatch(idx, /^(\.github\/|docs\/)?CODEOWNERS$/i) },
  { id: 'templates', label: 'Issue / PR templates', weight: 4, test: (idx) => firstMatch(idx, /^\.github\/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)/i) },
  { id: 'dependabot', label: 'Dependency updates (Dependabot / Renovate)', weight: 3, test: (idx) => firstMatch(idx, /^(\.github\/dependabot\.ya?ml|renovate\.json5?|\.renovaterc(\.json)?|\.github\/renovate\.json5?)$/i) },
  { id: 'funding', label: 'Funding / sponsors', weight: 1, test: (idx) => firstMatch(idx, /^\.github\/FUNDING\.ya?ml$/i) },
  { id: 'description', label: 'Repository description', weight: 2, test: (_idx, meta) => (meta && meta.description ? 'set' : null) },
];

function firstMatch(index, re) {
  for (const p of index.keys()) if (p && re.test(p)) return p;
  return null;
}

export function healthChecks(index, meta) {
  const results = CHECKS.map((c) => {
    const found = c.test(index, meta);
    return { id: c.id, label: c.label, weight: c.weight, ok: !!found, detail: found || null };
  });
  const total = results.reduce((s, r) => s + r.weight, 0);
  const got = results.reduce((s, r) => s + (r.ok ? r.weight : 0), 0);
  const score = Math.round((got / total) * 100);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'E';
  return { results, score, grade };
}

/** ASCII tree rendering for README embedding. */
export function toAsciiTree(root, { maxDepth = 3, maxChildren = 25 } = {}) {
  const lines = [root.name + '/'];
  function rec(node, prefix, depth) {
    if (!node.children || depth > maxDepth) return;
    const kids = node.children.slice(0, maxChildren);
    const hidden = node.children.length - kids.length;
    kids.forEach((c, i) => {
      const last = i === kids.length - 1 && hidden <= 0;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${c.name}${c.type === 'dir' ? '/' : ''}`);
      if (c.type === 'dir') rec(c, prefix + (last ? '    ' : '│   '), depth + 1);
    });
    if (hidden > 0) lines.push(`${prefix}└── … ${hidden} more`);
  }
  rec(root, '', 1);
  return lines.join('\n');
}

/** Plain JSON-able export of the hierarchy. */
export function toPlainTree(node) {
  const out = { name: node.name, path: node.path, type: node.type, size: node.size };
  if (node.type === 'file') { out.lang = node.lang; out.sha = node.sha; }
  if (node.children) { out.files = node.files; out.dirs = node.dirs; out.children = node.children.map(toPlainTree); }
  return out;
}
