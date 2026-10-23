/**
 * Dependency manifest discovery and parsing.
 * Pure module: no DOM, safe to import in Node tests.
 */

export const ECOSYSTEMS = {
  npm: { label: 'npm', registry: (n) => `https://www.npmjs.com/package/${n}` },
  pypi: { label: 'PyPI', registry: (n) => `https://pypi.org/project/${n}/` },
  go: { label: 'Go modules', registry: (n) => `https://pkg.go.dev/${n}` },
  cargo: { label: 'crates.io', registry: (n) => `https://crates.io/crates/${n}` },
  rubygems: { label: 'RubyGems', registry: (n) => `https://rubygems.org/gems/${n}` },
  packagist: { label: 'Packagist', registry: (n) => `https://packagist.org/packages/${n}` },
  maven: { label: 'Maven', registry: (n) => `https://mvnrepository.com/artifact/${n.replace(':', '/')}` },
  pub: { label: 'pub.dev', registry: (n) => `https://pub.dev/packages/${n}` },
  nuget: { label: 'NuGet', registry: (n) => `https://www.nuget.org/packages/${n}` },
  hex: { label: 'Hex', registry: (n) => `https://hex.pm/packages/${n}` },
  swift: { label: 'Swift PM', registry: (n) => `https://github.com/${n}` },
};

const MANIFEST_RULES = [
  { re: /(^|\/)package\.json$/, eco: 'npm', parse: parsePackageJson },
  { re: /(^|\/)requirements[^/]*\.txt$/, eco: 'pypi', parse: parseRequirements },
  { re: /(^|\/)pyproject\.toml$/, eco: 'pypi', parse: parsePyproject },
  { re: /(^|\/)Pipfile$/, eco: 'pypi', parse: parsePipfile },
  { re: /(^|\/)go\.mod$/, eco: 'go', parse: parseGoMod },
  { re: /(^|\/)Cargo\.toml$/, eco: 'cargo', parse: parseCargoToml },
  { re: /(^|\/)Gemfile$/, eco: 'rubygems', parse: parseGemfile },
  { re: /(^|\/)composer\.json$/, eco: 'packagist', parse: parseComposer },
  { re: /(^|\/)pom\.xml$/, eco: 'maven', parse: parsePom },
  { re: /(^|\/)build\.gradle(\.kts)?$/, eco: 'maven', parse: parseGradle },
  { re: /(^|\/)pubspec\.yaml$/, eco: 'pub', parse: parsePubspec },
  { re: /(^|\/)[^/]+\.csproj$/, eco: 'nuget', parse: parseCsproj },
  { re: /(^|\/)mix\.exs$/, eco: 'hex', parse: parseMix },
  { re: /(^|\/)Package\.swift$/, eco: 'swift', parse: parsePackageSwift },
];

const IGNORE_DIRS = /(^|\/)(node_modules|vendor|\.git|dist|build|out|target|__pycache__|\.venv|venv|bower_components|fixtures?|testdata|examples?|__fixtures__|snapshots?|templates?)(\/|$)/i;

/** Find manifest files in a flat path list, shallowest first, capped. */
export function findManifests(paths, { max = 10 } = {}) {
  const found = [];
  for (const p of paths) {
    if (IGNORE_DIRS.test(p)) continue;
    const rule = MANIFEST_RULES.find((r) => r.re.test(p));
    if (rule) found.push({ path: p, eco: rule.eco, depth: p.split('/').length - 1 });
  }
  found.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  return found.slice(0, max);
}

/** Parse a manifest's text into { path, eco, deps: [{name, version, kind}] }. */
export function parseManifest(path, text) {
  const rule = MANIFEST_RULES.find((r) => r.re.test(path));
  if (!rule) return { path, eco: 'unknown', deps: [] };
  try {
    const deps = dedupe(rule.parse(text) || []);
    return { path, eco: rule.eco, deps };
  } catch (err) {
    return { path, eco: rule.eco, deps: [], error: String((err && err.message) || err) };
  }
}

function dedupe(deps) {
  const seen = new Map();
  for (const d of deps) {
    if (!d || !d.name) continue;
    const key = d.name.toLowerCase();
    if (!seen.has(key)) seen.set(key, { name: d.name, version: d.version || '', kind: d.kind || 'runtime' });
  }
  return [...seen.values()];
}

// ---- parsers -------------------------------------------------------------

export function parsePackageJson(text) {
  const j = JSON.parse(text);
  const out = [];
  const take = (obj, kind) => { if (obj && typeof obj === 'object') for (const [name, version] of Object.entries(obj)) out.push({ name, version: String(version), kind }); };
  take(j.dependencies, 'runtime');
  take(j.peerDependencies, 'peer');
  take(j.optionalDependencies, 'optional');
  take(j.devDependencies, 'dev');
  return out;
}

export function parseRequirements(text) {
  const out = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
    if (!line || line.startsWith('-')) continue; // -r, -e, --index-url
    if (/^(https?|git\+|file:)/i.test(line)) continue;
    const m = line.match(/^([A-Za-z0-9_.\-]+)(\[[^\]]*\])?\s*([=<>!~]=?.*)?$/);
    if (m) out.push({ name: m[1], version: (m[3] || '').trim(), kind: 'runtime' });
  }
  return out;
}

export function parsePyproject(text) {
  const out = [];
  const proj = tomlSection(text, 'project');
  if (proj) {
    for (const s of tomlStringArray(proj, 'dependencies')) out.push(reqToDep(s, 'runtime'));
    const opt = tomlSection(text, 'project.optional-dependencies');
    if (opt) for (const s of allTomlStrings(opt)) out.push(reqToDep(s, 'optional'));
  }
  const depGroups = tomlSection(text, 'dependency-groups');
  if (depGroups) for (const s of allTomlStrings(depGroups)) out.push(reqToDep(s, 'dev'));
  const poetry = tomlSection(text, 'tool.poetry.dependencies');
  if (poetry) for (const [k, v] of tomlKeyValues(poetry)) if (k.toLowerCase() !== 'python') out.push({ name: k, version: v, kind: 'runtime' });
  const poetryDev = tomlSection(text, 'tool.poetry.dev-dependencies') || tomlSection(text, 'tool.poetry.group.dev.dependencies');
  if (poetryDev) for (const [k, v] of tomlKeyValues(poetryDev)) out.push({ name: k, version: v, kind: 'dev' });
  return out.filter(Boolean);
}

function reqToDep(s, kind) {
  const m = s.trim().match(/^([A-Za-z0-9_.\-]+)(\[[^\]]*\])?\s*(.*)$/);
  if (!m) return null;
  return { name: m[1], version: m[3].replace(/;.*$/, '').trim(), kind };
}

export function parsePipfile(text) {
  const out = [];
  const pk = tomlSection(text, 'packages');
  if (pk) for (const [k, v] of tomlKeyValues(pk)) out.push({ name: k, version: v, kind: 'runtime' });
  const dev = tomlSection(text, 'dev-packages');
  if (dev) for (const [k, v] of tomlKeyValues(dev)) out.push({ name: k, version: v, kind: 'dev' });
  return out;
}

export function parseGoMod(text) {
  const out = [];
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (/^require\s*\(/.test(line)) { inBlock = true; continue; }
    if (inBlock && line === ')') { inBlock = false; continue; }
    const m = inBlock ? line.match(/^(\S+)\s+(\S+)/) : line.match(/^require\s+(\S+)\s+(\S+)/);
    if (m) out.push({ name: m[1], version: m[2], kind: /\/\/\s*indirect/.test(raw) ? 'indirect' : 'runtime' });
  }
  return out;
}

export function parseCargoToml(text) {
  const out = [];
  const sections = [['dependencies', 'runtime'], ['dev-dependencies', 'dev'], ['build-dependencies', 'build'], ['workspace.dependencies', 'runtime']];
  for (const [name, kind] of sections) {
    const sec = tomlSection(text, name);
    if (sec) for (const [k, v] of tomlKeyValues(sec)) out.push({ name: k, version: v, kind });
  }
  const re = /^\[((?:dev-|build-)?dependencies)\.([^\]\s]+)\]\s*$/gm;
  let m;
  while ((m = re.exec(text))) {
    const sec = tomlSection(text, `${m[1]}.${m[2]}`);
    const ver = sec ? (tomlKeyValues(sec).find(([k]) => k === 'version') || [])[1] || '' : '';
    out.push({ name: m[2], version: ver, kind: m[1].startsWith('dev') ? 'dev' : m[1].startsWith('build') ? 'build' : 'runtime' });
  }
  return out;
}

export function parseGemfile(text) {
  const out = [];
  let group = 'runtime';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const g = line.match(/^group\s+(.+?)\s+do/);
    if (g) { group = /test|development/.test(g[1]) ? 'dev' : 'runtime'; continue; }
    if (line === 'end') { group = 'runtime'; continue; }
    const m = line.match(/^gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/);
    if (m) out.push({ name: m[1], version: m[2] || '', kind: group });
  }
  return out;
}

export function parseComposer(text) {
  const j = JSON.parse(text);
  const out = [];
  for (const [k, v] of Object.entries(j.require || {})) if (k !== 'php' && !k.startsWith('ext-')) out.push({ name: k, version: String(v), kind: 'runtime' });
  for (const [k, v] of Object.entries(j['require-dev'] || {})) out.push({ name: k, version: String(v), kind: 'dev' });
  return out;
}

export function parsePom(text) {
  const out = [];
  const blocks = text.match(/<dependencies>([\s\S]*?)<\/dependencies>/g) || [];
  for (const block of blocks) {
    const re = /<dependency>([\s\S]*?)<\/dependency>/g;
    let m;
    while ((m = re.exec(block))) {
      const g = (m[1].match(/<groupId>\s*([^<]+)\s*<\/groupId>/) || [])[1];
      const a = (m[1].match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/) || [])[1];
      const v = (m[1].match(/<version>\s*([^<]+)\s*<\/version>/) || [])[1] || '';
      const scope = (m[1].match(/<scope>\s*([^<]+)\s*<\/scope>/) || [])[1] || 'compile';
      if (a) out.push({ name: g ? `${g.trim()}:${a.trim()}` : a.trim(), version: v.trim(), kind: scope.trim() === 'test' ? 'dev' : 'runtime' });
    }
  }
  return out;
}

export function parseGradle(text) {
  const out = [];
  const re = /(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|kapt|ksp|annotationProcessor|classpath)\s*\(?\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text))) {
    const parts = m[2].split(':');
    if (parts.length >= 2) out.push({ name: `${parts[0]}:${parts[1]}`, version: parts[2] || '', kind: /^test/.test(m[1]) ? 'dev' : 'runtime' });
  }
  return out;
}

export function parsePubspec(text) {
  const out = [];
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\S/.test(raw)) { section = /^dependencies:/.test(raw) ? 'runtime' : /^dev_dependencies:/.test(raw) ? 'dev' : null; continue; }
    if (!section) continue;
    const m = raw.match(/^ {2}([A-Za-z0-9_]+):\s*(\S.*)?$/);
    if (m && m[1] !== 'sdk') out.push({ name: m[1], version: (m[2] || '').trim(), kind: section });
  }
  return out;
}

export function parseCsproj(text) {
  const out = [];
  const re = /<PackageReference\s+([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(text))) {
    const inc = (m[1].match(/Include="([^"]+)"/) || [])[1];
    const ver = (m[1].match(/Version="([^"]+)"/) || [])[1] || '';
    if (inc) out.push({ name: inc, version: ver, kind: 'runtime' });
  }
  return out;
}

export function parseMix(text) {
  const out = [];
  const block = text.match(/defp?\s+deps\s+do([\s\S]*?)\n\s*end/);
  if (!block) return out;
  const re = /\{:([a-z0-9_]+)\s*,\s*(?:"([^"]+)")?([^}]*)\}/g;
  let m;
  while ((m = re.exec(block[1]))) out.push({ name: m[1], version: m[2] || '', kind: /only:\s*(\[?\s*:test|:dev)/.test(m[3] || '') ? 'dev' : 'runtime' });
  return out;
}

export function parsePackageSwift(text) {
  const out = [];
  const re = /\.package\s*\(\s*(?:name:\s*"[^"]*"\s*,\s*)?url:\s*"([^"]+)"\s*,\s*([^)]*)\)/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1].replace(/\.git$/, '').replace(/^https?:\/\/github\.com\//, '');
    const ver = (m[2].match(/"([^"]+)"/) || [])[1] || '';
    out.push({ name, version: ver, kind: 'runtime' });
  }
  return out;
}

// ---- tiny TOML helpers (good enough for manifests) -------------------------

function tomlSection(text, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\[${esc}\\]\\s*$`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^\s*\[[^\]]+\]\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
}

function tomlKeyValues(section) {
  const out = [];
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^("?)([A-Za-z0-9_.\-]+)\1\s*=\s*(.+)$/);
    if (!m) continue;
    let v = m[3].trim();
    if (v.startsWith('{')) {
      const vm = v.match(/version\s*=\s*"([^"]*)"/);
      v = vm ? vm[1] : (/(path|git|workspace)\s*=/.test(v) ? 'local' : '');
    } else {
      v = v.replace(/^["']|["']$/g, '');
    }
    out.push([m[2], v]);
  }
  return out;
}

function tomlStringArray(section, key) {
  const re = new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm');
  const m = re.exec(section);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]*)"|'([^']*)'/g)].map((x) => x[1] ?? x[2]);
}

function allTomlStrings(section) {
  return [...section.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((s) => /^[A-Za-z0-9_.\-]+(\[|\s|$|[<>=!~])/.test(s));
}
