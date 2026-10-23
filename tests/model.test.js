import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extOf, detectLanguage, languageColor, isBinaryName, hljsLanguage } from '../src/model/languages.js';
import { buildHierarchy, computeStats, pruneHierarchy, healthChecks, toAsciiTree, toPlainTree, findByPath, ancestorsOf, dominantLanguage } from '../src/model/tree.js';

const ENTRIES = [
  { path: 'README.md', type: 'blob', size: 1200, sha: 'a1' },
  { path: 'LICENSE', type: 'blob', size: 1000, sha: 'a2' },
  { path: '.gitignore', type: 'blob', size: 20, sha: 'a3' },
  { path: 'package.json', type: 'blob', size: 300, sha: 'a4' },
  { path: 'src', type: 'tree', sha: 't1' },
  { path: 'src/index.js', type: 'blob', size: 5000, sha: 'b1' },
  { path: 'src/util.ts', type: 'blob', size: 2000, sha: 'b2' },
  { path: 'src/deep', type: 'tree', sha: 't2' },
  { path: 'src/deep/er', type: 'tree', sha: 't3' },
  { path: 'src/deep/er/file.py', type: 'blob', size: 10, sha: 'b3' },
  { path: 'assets/logo.png', type: 'blob', size: 40000, sha: 'c1' }, // no explicit tree entry for assets
  { path: 'tests/index.test.js', type: 'blob', size: 800, sha: 'd1' },
  { path: '.github/workflows/ci.yml', type: 'blob', size: 400, sha: 'e1' },
  { path: 'vendor/lib', type: 'commit', sha: 'f1' },
  { path: 'empty.txt', type: 'blob', size: 0, sha: 'g1' },
];

test('extOf handles plain, dotfiles and d.ts', () => {
  assert.equal(extOf('index.js'), 'js');
  assert.equal(extOf('.gitignore'), 'gitignore');
  assert.equal(extOf('types.d.ts'), 'd.ts');
  assert.equal(extOf('Makefile'), '');
  assert.equal(extOf('ARCHIVE.TAR.GZ'), 'gz');
});

test('detectLanguage maps extensions and special filenames', () => {
  assert.equal(detectLanguage('main.rs'), 'Rust');
  assert.equal(detectLanguage('App.tsx'), 'TypeScript');
  assert.equal(detectLanguage('Dockerfile'), 'Dockerfile');
  assert.equal(detectLanguage('dockerfile.prod'), 'Dockerfile');
  assert.equal(detectLanguage('CMakeLists.txt'), 'CMake');
  assert.equal(detectLanguage('LICENSE-MIT'), 'License');
  assert.equal(detectLanguage('README'), 'Markdown');
  assert.equal(detectLanguage('yarn.lock'), 'Lockfile');
  assert.equal(detectLanguage('weird.unknownext'), 'Other');
  assert.equal(detectLanguage('photo.JPG'), 'Image');
});

test('languageColor returns a colour for known and unknown languages', () => {
  assert.match(languageColor('JavaScript'), /^#/);
  assert.match(languageColor('Made Up Lang'), /^hsl\(/);
});

test('isBinaryName and hljsLanguage', () => {
  assert.equal(isBinaryName('a.png'), true);
  assert.equal(isBinaryName('a.js'), false);
  assert.equal(hljsLanguage('a.py'), 'python');
  assert.equal(hljsLanguage('a.svg'), 'xml');
  assert.equal(hljsLanguage('a.whatever'), 'plaintext');
});

test('buildHierarchy aggregates sizes, counts, depth and implicit directories', () => {
  const { root, index } = buildHierarchy(ENTRIES, { rootName: 'repo' });
  assert.equal(root.name, 'repo');
  assert.equal(root.files, 12); // 11 blobs + 1 submodule
  assert.equal(root.size, 1200 + 1000 + 20 + 300 + 5000 + 2000 + 10 + 40000 + 800 + 400);
  assert.ok(index.has('assets'), 'implicit directory created from a blob path');
  assert.equal(index.get('assets').type, 'dir');
  assert.equal(index.get('src').files, 3);
  assert.equal(index.get('src').dirs, 2);
  assert.equal(index.get('src').maxDepth, 4);
  assert.equal(index.get('src/deep/er/file.py').depth, 4);
  assert.equal(index.get('vendor/lib').type, 'submodule');
  // directories first, then by size desc
  assert.equal(root.children[0].type, 'dir');
  assert.equal(root.children[0].name, 'assets');
  assert.equal(index.get('src').lang, 'JavaScript');
});

test('dominantLanguage prefers code over non-code', () => {
  assert.equal(dominantLanguage(new Map([['Markdown', 5000], ['Python', 10]])), 'Python');
  assert.equal(dominantLanguage(new Map([['Markdown', 5000], ['JSON', 10]])), 'Markdown');
});

test('computeStats reports totals, extensions and largest items', () => {
  const { root } = buildHierarchy(ENTRIES, { rootName: 'repo' });
  const s = computeStats(root);
  assert.equal(s.totalFiles, 12);
  assert.equal(s.totalDirs, 8); // src, src/deep, src/deep/er, assets, tests, .github, .github/workflows, vendor
  assert.equal(s.maxDepth, 4);
  assert.equal(s.deepest.path, 'src/deep/er/file.py');
  assert.equal(s.extensions.find((e) => e.ext === 'js').count, 2);
  assert.ok(s.extensions.every((e, i) => i === 0 || s.extensions[i - 1].count >= e.count), 'extensions sorted by count');
  assert.equal(s.largestFiles[0].path, 'assets/logo.png');
  assert.equal(s.largestDirs[0].path, 'assets');
  assert.equal(s.testFiles, 1);
  assert.equal(s.zeroByte, 1);
  assert.equal(s.binaryBytes, 40000);
  assert.equal(s.depthHist.length, 5);
});

test('pruneHierarchy caps depth and folds crowded folders', () => {
  const entries = [];
  for (let i = 0; i < 200; i++) entries.push({ path: `big/f${i}.js`, type: 'blob', size: 1000 - i, sha: `s${i}` });
  for (let d = 1; d <= 6; d++) entries.push({ path: `${'n/'.repeat(d)}leaf${d}.js`, type: 'blob', size: 10, sha: `d${d}` });
  const { root } = buildHierarchy(entries);
  const pruned = pruneHierarchy(root, { maxNodes: 60, maxChildren: 10 });
  const big = pruned.children.find((c) => c.name === 'big');
  assert.equal(big.children.length, 10);
  const group = big.children.find((c) => c.type === 'group');
  assert.ok(group, 'group node present');
  assert.equal(group.count, 191);
  assert.equal(group.size, entries.slice(9, 200).reduce((s, e) => s + e.size, 0));
  assert.ok(pruned.prunedCount <= 60 + 15, `pruned to ${pruned.prunedCount}`);
  let maxDepth = 0;
  (function walk(n) { maxDepth = Math.max(maxDepth, n.depth); (n.children || []).forEach(walk); })(pruned);
  assert.ok(maxDepth <= pruned.prunedTo + 1);
  // original untouched
  assert.equal(root.children.find((c) => c.name === 'big').children.length, 200);
});

test('healthChecks scores conventions found in the index', () => {
  const { index } = buildHierarchy(ENTRIES);
  const h = healthChecks(index, { description: 'x' });
  const byId = Object.fromEntries(h.results.map((r) => [r.id, r]));
  assert.equal(byId.readme.ok, true);
  assert.equal(byId.license.ok, true);
  assert.equal(byId.ci.ok, true);
  assert.equal(byId.tests.ok, true);
  assert.equal(byId.manifest.ok, true);
  assert.equal(byId.contributing.ok, false);
  assert.equal(byId.description.ok, true);
  assert.ok(h.score > 0 && h.score <= 100);
  assert.match(h.grade, /^[A-E]$/);
  const empty = healthChecks(new Map([['', {}]]), {});
  assert.equal(empty.score, 0);
  assert.equal(empty.grade, 'E');
});

test('findByPath and ancestorsOf navigate the tree', () => {
  const { root } = buildHierarchy(ENTRIES);
  assert.equal(findByPath(root, 'src/deep/er').type, 'dir');
  assert.equal(findByPath(root, 'nope/x'), null);
  assert.equal(findByPath(root, '').name, 'root');
  const anc = ancestorsOf(root, 'src/deep/er/file.py');
  assert.deepEqual(anc.map((n) => n.name), ['root', 'src', 'deep', 'er', 'file.py']);
});

test('toAsciiTree and toPlainTree render the structure', () => {
  const { root } = buildHierarchy(ENTRIES, { rootName: 'repo' });
  const ascii = toAsciiTree(root, { maxDepth: 2, maxChildren: 3 });
  assert.ok(ascii.startsWith('repo/'));
  assert.ok(ascii.includes('├── '));
  assert.ok(ascii.includes('more'));
  const plain = toPlainTree(root);
  assert.equal(plain.name, 'repo');
  assert.ok(Array.isArray(plain.children));
  assert.equal(JSON.parse(JSON.stringify(plain)).children.length, root.children.length);
});
