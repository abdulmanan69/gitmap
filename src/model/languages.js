/**
 * Language detection by file name / extension, with GitHub Linguist colors.
 * Pure module: no DOM, safe to import in Node tests.
 */

const LANGS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572A5',
  Ruby: '#701516',
  Go: '#00ADD8',
  Rust: '#dea584',
  Java: '#b07219',
  Kotlin: '#A97BFF',
  Swift: '#F05138',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  PHP: '#4F5D95',
  HTML: '#e34c26',
  CSS: '#663399',
  SCSS: '#c6538c',
  Sass: '#a53b70',
  Less: '#1d365d',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Astro: '#ff5a03',
  Dart: '#00B4AB',
  Scala: '#c22d40',
  Shell: '#89e051',
  PowerShell: '#012456',
  Batchfile: '#C1F12E',
  Lua: '#000080',
  R: '#198CE7',
  'Objective-C': '#438eff',
  Perl: '#0298c3',
  Elixir: '#6e4a7e',
  Erlang: '#B83998',
  Haskell: '#5e5086',
  Clojure: '#db5855',
  OCaml: '#ef7a08',
  'F#': '#b845fc',
  Julia: '#a270ba',
  Nim: '#ffc200',
  Zig: '#ec915c',
  Solidity: '#AA6746',
  JSON: '#8a8f99',
  YAML: '#cb171e',
  TOML: '#9c4221',
  XML: '#0060ac',
  Markdown: '#083fa1',
  reStructuredText: '#141414',
  Text: '#7a7f8a',
  CSV: '#237346',
  SQL: '#e38c00',
  GraphQL: '#e10098',
  'Protocol Buffer': '#5c6bc0',
  Dockerfile: '#384d54',
  Makefile: '#427819',
  CMake: '#DA3434',
  Gradle: '#02303a',
  HCL: '#844FBA',
  Nix: '#7e7eff',
  Assembly: '#6E4C13',
  'Jupyter Notebook': '#DA5B0B',
  TeX: '#3D6117',
  Handlebars: '#f7931e',
  EJS: '#a91e50',
  Pug: '#a86454',
  Prisma: '#0c344b',
  WebAssembly: '#04133b',
  Image: '#2f9e8f',
  Font: '#6b7a99',
  Media: '#8e44ad',
  Lockfile: '#5b6472',
  Config: '#7a8599',
  License: '#b8a04a',
  Git: '#f05033',
  Groovy: '#4298b8',
  Emacs: '#c065db',
  Elm: '#60B5CC',
  PureScript: '#1D222D',
  ReScript: '#ed5051',
  Crystal: '#000100',
  'Vim Script': '#199f4b',
  Mojo: '#ff4c1f',
  Gleam: '#ffaff3',
  Odin: '#60AFFE',
  V: '#4f87c4',
  D: '#ba595e',
  Fortran: '#4d41b1',
  COBOL: '#005ca5',
  Pascal: '#E3F171',
  Terraform: '#844FBA',
  Smarty: '#f0c040',
  Twig: '#c1d026',
  Razor: '#9d5200',
  Starlark: '#76d275',
  Other: '#4f5a7a',
};

const EXT = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript',
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript', 'd.ts': 'TypeScript',
  py: 'Python', pyi: 'Python', pyw: 'Python', pyx: 'Python',
  rb: 'Ruby', rake: 'Ruby', gemspec: 'Ruby', erb: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  java: 'Java', jar: 'Java', class: 'Java',
  kt: 'Kotlin', kts: 'Kotlin',
  swift: 'Swift',
  c: 'C', h: 'C',
  cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++', hxx: 'C++', ipp: 'C++', inl: 'C++',
  cs: 'C#', csx: 'C#', razor: 'Razor', cshtml: 'Razor',
  php: 'PHP', phtml: 'PHP',
  html: 'HTML', htm: 'HTML', xhtml: 'HTML',
  css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less', styl: 'CSS', pcss: 'CSS',
  vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
  dart: 'Dart',
  scala: 'Scala', sc: 'Scala', sbt: 'Scala',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell', ksh: 'Shell',
  ps1: 'PowerShell', psm1: 'PowerShell', psd1: 'PowerShell',
  bat: 'Batchfile', cmd: 'Batchfile',
  lua: 'Lua',
  r: 'R', rmd: 'R',
  m: 'Objective-C', mm: 'Objective-C',
  pl: 'Perl', pm: 'Perl', t: 'Perl',
  ex: 'Elixir', exs: 'Elixir', heex: 'Elixir', eex: 'Elixir',
  erl: 'Erlang', hrl: 'Erlang',
  hs: 'Haskell', lhs: 'Haskell',
  clj: 'Clojure', cljs: 'Clojure', cljc: 'Clojure', edn: 'Clojure',
  ml: 'OCaml', mli: 'OCaml',
  fs: 'F#', fsx: 'F#', fsi: 'F#',
  jl: 'Julia',
  nim: 'Nim', nims: 'Nim',
  zig: 'Zig',
  sol: 'Solidity',
  json: 'JSON', jsonc: 'JSON', json5: 'JSON', geojson: 'JSON', webmanifest: 'JSON', map: 'JSON',
  yml: 'YAML', yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML', xsd: 'XML', xsl: 'XML', xslt: 'XML', plist: 'XML', storyboard: 'XML', xib: 'XML',
  md: 'Markdown', mdx: 'Markdown', markdown: 'Markdown', mkd: 'Markdown',
  rst: 'reStructuredText',
  txt: 'Text', text: 'Text', log: 'Text', adoc: 'Text', asciidoc: 'Text', org: 'Text',
  csv: 'CSV', tsv: 'CSV',
  sql: 'SQL', psql: 'SQL', mysql: 'SQL',
  graphql: 'GraphQL', gql: 'GraphQL', graphqls: 'GraphQL',
  proto: 'Protocol Buffer',
  dockerfile: 'Dockerfile',
  mk: 'Makefile', mak: 'Makefile',
  cmake: 'CMake',
  gradle: 'Gradle',
  tf: 'Terraform', tfvars: 'Terraform', hcl: 'HCL',
  nix: 'Nix',
  asm: 'Assembly', s: 'Assembly',
  ipynb: 'Jupyter Notebook',
  tex: 'TeX', sty: 'TeX', cls: 'TeX', bib: 'TeX',
  hbs: 'Handlebars', handlebars: 'Handlebars', mustache: 'Handlebars',
  ejs: 'EJS',
  pug: 'Pug', jade: 'Pug',
  prisma: 'Prisma',
  wasm: 'WebAssembly', wat: 'WebAssembly',
  png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', webp: 'Image', avif: 'Image', ico: 'Image', bmp: 'Image', tiff: 'Image', tif: 'Image', svg: 'Image', psd: 'Image', ai: 'Image', heic: 'Image',
  woff: 'Font', woff2: 'Font', ttf: 'Font', otf: 'Font', eot: 'Font',
  mp4: 'Media', mp3: 'Media', wav: 'Media', ogg: 'Media', webm: 'Media', mov: 'Media', flac: 'Media', m4a: 'Media', avi: 'Media',
  lock: 'Lockfile',
  ini: 'Config', cfg: 'Config', conf: 'Config', env: 'Config', properties: 'Config', editorconfig: 'Config',
  gitattributes: 'Git', gitignore: 'Git', gitmodules: 'Git',
  npmrc: 'Config', nvmrc: 'Config', babelrc: 'JSON', eslintrc: 'JSON', prettierrc: 'JSON', browserslistrc: 'Config', dockerignore: 'Config', prettierignore: 'Config', eslintignore: 'Config',
  groovy: 'Groovy', gvy: 'Groovy',
  vim: 'Vim Script', vimrc: 'Vim Script',
  el: 'Emacs',
  elm: 'Elm',
  purs: 'PureScript',
  res: 'ReScript', resi: 'ReScript',
  cr: 'Crystal',
  mojo: 'Mojo',
  gleam: 'Gleam',
  odin: 'Odin',
  v: 'V',
  d: 'D',
  f90: 'Fortran', f95: 'Fortran', f03: 'Fortran', f: 'Fortran', for: 'Fortran',
  cob: 'COBOL', cbl: 'COBOL',
  pas: 'Pascal', pp: 'Pascal',
  tpl: 'Smarty', twig: 'Twig',
  bzl: 'Starlark', bazel: 'Starlark',
};

const FILENAMES = {
  dockerfile: 'Dockerfile',
  containerfile: 'Dockerfile',
  makefile: 'Makefile',
  gnumakefile: 'Makefile',
  'cmakelists.txt': 'CMake',
  gemfile: 'Ruby',
  rakefile: 'Ruby',
  guardfile: 'Ruby',
  podfile: 'Ruby',
  fastfile: 'Ruby',
  brewfile: 'Ruby',
  procfile: 'Config',
  vagrantfile: 'Ruby',
  jenkinsfile: 'Groovy',
  'build.gradle': 'Gradle',
  'settings.gradle': 'Gradle',
  gradlew: 'Shell',
  'package.json': 'JSON',
  'package-lock.json': 'Lockfile',
  'yarn.lock': 'Lockfile',
  'pnpm-lock.yaml': 'Lockfile',
  'bun.lockb': 'Lockfile',
  'cargo.lock': 'Lockfile',
  'poetry.lock': 'Lockfile',
  'pipfile.lock': 'Lockfile',
  'composer.lock': 'Lockfile',
  'gemfile.lock': 'Lockfile',
  'go.sum': 'Lockfile',
  'flake.lock': 'Lockfile',
  'pubspec.lock': 'Lockfile',
  'uv.lock': 'Lockfile',
  'go.mod': 'Go',
  'cargo.toml': 'TOML',
  'pyproject.toml': 'TOML',
  pipfile: 'TOML',
  license: 'License',
  'license.md': 'License',
  'license.txt': 'License',
  licence: 'License',
  copying: 'License',
  notice: 'License',
  codeowners: 'Config',
  '.gitignore': 'Git',
  '.gitattributes': 'Git',
  '.gitmodules': 'Git',
  '.mailmap': 'Git',
  '.editorconfig': 'Config',
  '.env': 'Config',
  '.env.example': 'Config',
  '.nvmrc': 'Config',
  '.npmrc': 'Config',
  '.prettierrc': 'JSON',
  '.eslintrc': 'JSON',
  '.babelrc': 'JSON',
  build: 'Starlark',
  workspace: 'Starlark',
  'build.bazel': 'Starlark',
  'workspace.bazel': 'Starlark',
  '.vimrc': 'Vim Script',
};

const NON_TEXT = new Set(['Image', 'Font', 'Media', 'WebAssembly']);
const BINARY_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tiff', 'tif', 'psd', 'ai', 'heic', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'mp3', 'wav', 'ogg', 'webm', 'mov', 'flac', 'm4a', 'avi', 'wasm', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'class', 'pdf', 'exe', 'dll', 'so', 'dylib', 'o', 'a', 'bin', 'dat', 'db', 'sqlite', 'lockb', 'pyc', 'pyo', 'rds', 'parquet', 'ds_store']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'svg']);

/** Lower-cased extension (no dot) of a file name, '' when none. Dotfiles return their name without the dot. */
export function extOf(name) {
  const base = String(name || '').toLowerCase();
  if (base.endsWith('.d.ts')) return 'd.ts';
  const i = base.lastIndexOf('.');
  if (i === -1) return '';
  if (i === 0) return base.slice(1); // .gitignore -> gitignore
  return base.slice(i + 1);
}

/** Detect the language for a file name. Falls back to 'Other'. */
export function detectLanguage(name) {
  const lower = String(name || '').toLowerCase();
  if (FILENAMES[lower]) return FILENAMES[lower];
  if (lower.startsWith('dockerfile.') || lower.endsWith('.dockerfile')) return 'Dockerfile';
  if (lower.startsWith('license') || lower.startsWith('licence') || lower.startsWith('copying')) return 'License';
  if (lower.startsWith('readme')) return 'Markdown';
  if (lower.startsWith('.env')) return 'Config';
  const ext = extOf(name);
  if (!ext) return 'Other';
  return EXT[ext] || 'Other';
}

export function languageColor(lang) {
  return LANGS[lang] || hashColor(lang || 'Other');
}

export function allLanguages() {
  return LANGS;
}

export function isBinaryName(name) {
  return BINARY_EXT.has(extOf(name));
}

export function isImageName(name) {
  return IMAGE_EXT.has(extOf(name));
}

export function isTextLanguage(lang) {
  return !NON_TEXT.has(lang);
}

/** Map a file name to a highlight.js language id. */
export function hljsLanguage(name) {
  const lang = detectLanguage(name);
  const ext = extOf(name);
  const direct = {
    JavaScript: 'javascript', TypeScript: 'typescript', Python: 'python', Ruby: 'ruby', Go: 'go', Rust: 'rust', Java: 'java', Kotlin: 'kotlin',
    Swift: 'swift', C: 'c', 'C++': 'cpp', 'C#': 'csharp', PHP: 'php', HTML: 'xml', CSS: 'css', SCSS: 'scss', Less: 'less', Dart: 'dart', Scala: 'scala',
    Shell: 'bash', PowerShell: 'powershell', Lua: 'lua', R: 'r', 'Objective-C': 'objectivec', Perl: 'perl', Elixir: 'elixir', Erlang: 'erlang', Haskell: 'haskell',
    Clojure: 'clojure', OCaml: 'ocaml', 'F#': 'fsharp', Julia: 'julia', Nim: 'nim', JSON: 'json', YAML: 'yaml', TOML: 'ini', XML: 'xml', Markdown: 'markdown',
    SQL: 'sql', GraphQL: 'graphql', 'Protocol Buffer': 'protobuf', Dockerfile: 'dockerfile', Makefile: 'makefile', CMake: 'cmake', Gradle: 'gradle', Groovy: 'groovy',
    Nix: 'nix', Assembly: 'x86asm', TeX: 'latex', Handlebars: 'handlebars', Vue: 'xml', Svelte: 'xml', Astro: 'xml', Config: 'ini', Elm: 'elm', Crystal: 'crystal', Fortran: 'fortran',
    Zig: 'zig', HCL: 'ini', Terraform: 'ini', 'Vim Script': 'vim', D: 'd', Pascal: 'delphi', Smarty: 'xml', Twig: 'twig', Batchfile: 'dos', Solidity: 'solidity',
  };
  if (ext === 'svg') return 'xml';
  return direct[lang] || 'plaintext';
}

function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 45% 55%)`;
}
