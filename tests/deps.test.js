import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findManifests, parseManifest, parsePackageJson, parseRequirements, parsePyproject, parsePipfile, parseGoMod,
  parseCargoToml, parseGemfile, parseComposer, parsePom, parseGradle, parsePubspec, parseCsproj, parseMix, parsePackageSwift, ECOSYSTEMS,
} from '../src/model/deps.js';

const names = (deps) => deps.map((d) => d.name);

test('findManifests picks known files, shallowest first, skipping vendored dirs', () => {
  const found = findManifests([
    'node_modules/x/package.json', 'packages/a/package.json', 'package.json', 'go.mod', 'docs/requirements.txt', 'examples/demo/Cargo.toml', 'src/App.csproj',
  ]);
  assert.deepEqual(found.map((f) => f.path), ['go.mod', 'package.json', 'docs/requirements.txt', 'src/App.csproj', 'packages/a/package.json']);
  assert.equal(found[0].eco, 'go');
  assert.equal(findManifests(['a/b/package.json', 'package.json'], { max: 1 }).length, 1);
});

test('parsePackageJson collects every dependency kind', () => {
  const deps = parsePackageJson(JSON.stringify({ dependencies: { d3: '^7' }, devDependencies: { vitest: '1.0.0' }, peerDependencies: { react: '>=18' }, optionalDependencies: { fsevents: '*' } }));
  assert.deepEqual(deps, [
    { name: 'd3', version: '^7', kind: 'runtime' },
    { name: 'react', version: '>=18', kind: 'peer' },
    { name: 'fsevents', version: '*', kind: 'optional' },
    { name: 'vitest', version: '1.0.0', kind: 'dev' },
  ]);
});

test('parseRequirements ignores comments, flags and urls', () => {
  const deps = parseRequirements('# comment\nrequests>=2.0 # inline\n-r base.txt\nflask[async]==3.0\n--index-url https://x\ngit+https://github.com/a/b\n\nnumpy\n');
  assert.deepEqual(names(deps), ['requests', 'flask', 'numpy']);
  assert.equal(deps[0].version, '>=2.0');
  assert.equal(deps[1].version, '==3.0');
});

test('parsePyproject reads PEP 621, optional groups and Poetry', () => {
  const text = `
[project]
name = "x"
dependencies = [
  "httpx>=0.25",
  "click",
]

[project.optional-dependencies]
dev = ["pytest>=8", "ruff"]

[tool.poetry.dependencies]
python = "^3.11"
rich = "^13"

[tool.poetry.group.dev.dependencies]
mypy = "*"
`;
  const deps = parsePyproject(text);
  const byName = Object.fromEntries(deps.map((d) => [d.name, d]));
  assert.equal(byName.httpx.version, '>=0.25');
  assert.equal(byName.click.kind, 'runtime');
  assert.equal(byName.pytest.kind, 'optional');
  assert.equal(byName.rich.version, '^13');
  assert.equal(byName.mypy.kind, 'dev');
  assert.equal(byName.python, undefined);
});

test('parsePipfile reads packages and dev-packages', () => {
  const deps = parsePipfile('[packages]\nrequests = "*"\n\n[dev-packages]\npytest = ">=7"\n');
  assert.deepEqual(deps, [{ name: 'requests', version: '*', kind: 'runtime' }, { name: 'pytest', version: '>=7', kind: 'dev' }]);
});

test('parseGoMod handles single and block requires with indirect flag', () => {
  const deps = parseGoMod('module x\n\ngo 1.21\n\nrequire github.com/a/b v1.2.3\n\nrequire (\n\tgolang.org/x/net v0.1.0\n\tgithub.com/c/d v2.0.0 // indirect\n)\n');
  assert.deepEqual(deps, [
    { name: 'github.com/a/b', version: 'v1.2.3', kind: 'runtime' },
    { name: 'golang.org/x/net', version: 'v0.1.0', kind: 'runtime' },
    { name: 'github.com/c/d', version: 'v2.0.0', kind: 'indirect' },
  ]);
});

test('parseCargoToml reads inline, table and dev dependencies', () => {
  const text = `
[package]
name = "x"

[dependencies]
serde = { version = "1", features = ["derive"] }
tokio = "1.35"
local = { path = "../local" }

[dev-dependencies]
criterion = "0.5"

[dependencies.reqwest]
version = "0.11"
features = ["json"]
`;
  const deps = parseCargoToml(text);
  const byName = Object.fromEntries(deps.map((d) => [d.name, d]));
  assert.equal(byName.serde.version, '1');
  assert.equal(byName.tokio.version, '1.35');
  assert.equal(byName.local.version, 'local');
  assert.equal(byName.criterion.kind, 'dev');
  assert.equal(byName.reqwest.version, '0.11');
});

test('parseGemfile tracks groups', () => {
  const deps = parseGemfile("source 'https://rubygems.org'\ngem 'rails', '~> 7.1'\ngroup :test do\n  gem 'rspec'\nend\ngem \"puma\"\n");
  assert.deepEqual(deps, [
    { name: 'rails', version: '~> 7.1', kind: 'runtime' },
    { name: 'rspec', version: '', kind: 'dev' },
    { name: 'puma', version: '', kind: 'runtime' },
  ]);
});

test('parseComposer skips php and extensions', () => {
  const deps = parseComposer(JSON.stringify({ require: { php: '^8.2', 'ext-json': '*', 'laravel/framework': '^11' }, 'require-dev': { 'phpunit/phpunit': '^10' } }));
  assert.deepEqual(names(deps), ['laravel/framework', 'phpunit/phpunit']);
  assert.equal(deps[1].kind, 'dev');
});

test('parsePom reads groupId:artifactId and test scope', () => {
  const deps = parsePom('<project><dependencies><dependency><groupId>org.x</groupId><artifactId>lib</artifactId><version>1.0</version></dependency><dependency><groupId>junit</groupId><artifactId>junit</artifactId><scope>test</scope></dependency></dependencies></project>');
  assert.deepEqual(deps, [{ name: 'org.x:lib', version: '1.0', kind: 'runtime' }, { name: 'junit:junit', version: '', kind: 'dev' }]);
});

test('parseGradle reads string notation', () => {
  const deps = parseGradle("dependencies {\n  implementation 'com.squareup.okhttp3:okhttp:4.12.0'\n  testImplementation(\"junit:junit:4.13.2\")\n}\n");
  assert.deepEqual(deps, [{ name: 'com.squareup.okhttp3:okhttp', version: '4.12.0', kind: 'runtime' }, { name: 'junit:junit', version: '4.13.2', kind: 'dev' }]);
});

test('parsePubspec reads dependency sections', () => {
  const deps = parsePubspec('name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  http: ^1.1.0\ndev_dependencies:\n  test: any\n');
  assert.deepEqual(deps, [{ name: 'flutter', version: '', kind: 'runtime' }, { name: 'http', version: '^1.1.0', kind: 'runtime' }, { name: 'test', version: 'any', kind: 'dev' }]);
});

test('parseCsproj reads PackageReference', () => {
  const deps = parseCsproj('<Project><ItemGroup><PackageReference Include="Newtonsoft.Json" Version="13.0.3" /><PackageReference Version="8.0.0" Include="Serilog"/></ItemGroup></Project>');
  assert.deepEqual(deps, [{ name: 'Newtonsoft.Json', version: '13.0.3', kind: 'runtime' }, { name: 'Serilog', version: '8.0.0', kind: 'runtime' }]);
});

test('parseMix reads the deps block', () => {
  const deps = parseMix('defp deps do\n  [\n    {:phoenix, "~> 1.7"},\n    {:ex_doc, "~> 0.30", only: :dev, runtime: false}\n  ]\nend\n');
  assert.deepEqual(deps, [{ name: 'phoenix', version: '~> 1.7', kind: 'runtime' }, { name: 'ex_doc', version: '~> 0.30', kind: 'dev' }]);
});

test('parsePackageSwift reads package urls', () => {
  const deps = parsePackageSwift('dependencies: [\n .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.2.0"),\n .package(name: "X", url: "https://github.com/a/b", .upToNextMajor(from: "2.0.0"))\n]');
  assert.deepEqual(names(deps), ['apple/swift-argument-parser', 'a/b']);
  assert.equal(deps[0].version, '1.2.0');
});

test('parseManifest dedupes and survives malformed input', () => {
  const ok = parseManifest('package.json', '{"dependencies":{"a":"1"},"devDependencies":{"A":"2"}}');
  assert.equal(ok.eco, 'npm');
  assert.equal(ok.deps.length, 1);
  const bad = parseManifest('package.json', '{not json');
  assert.equal(bad.deps.length, 0);
  assert.ok(bad.error);
  assert.equal(parseManifest('unknown.txt', '').eco, 'unknown');
});

test('ECOSYSTEMS build registry links', () => {
  assert.equal(ECOSYSTEMS.npm.registry('d3'), 'https://www.npmjs.com/package/d3');
  assert.equal(ECOSYSTEMS.maven.registry('org.x:lib'), 'https://mvnrepository.com/artifact/org.x/lib');
});
