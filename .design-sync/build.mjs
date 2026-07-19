// Design-sync build for @repo/ui (shadcn + Tailwind).
//
// The package ships neither compiled JS/`.d.ts` nor a compiled stylesheet — it
// exports `.ts`/`.tsx` straight from src/, and styles entirely via Tailwind
// utility classes resolved at the host app's build time. The design-sync
// converter needs both a built entry with real `.d.ts` (for component discovery
// and the prop contracts the design agent codes against) and a real stylesheet.
// This script produces them into packages/ui/dist (gitignored):
//
//   1. tsc → dist/*.js + dist/*.d.ts (mirrors src/), plus a dist/package.json
//      so the converter treats dist/ as the package root with resolvable types.
//   2. tailwindcss → dist/ds.css: all utility classes the components use + the
//      shadcn token :root vars + the three font CSS vars the host Next.js app
//      normally injects via next/font (with system fallbacks). The @font-face
//      rules + woff2 ship separately via cfg.extraFonts.
//
// Run from anywhere: `node .design-sync/build.mjs`. Deterministic, no network.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const uiDir = path.join(repoRoot, 'packages', 'ui');
const distDir = path.join(uiDir, 'dist');
const binExt = process.platform === 'win32' ? '.cmd' : '';
const bin = (name) => path.join(uiDir, 'node_modules', '.bin', name + binExt);

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

// ── 1. Declaration + JS build via tsc ────────────────────────────────────────
const buildTsconfig = path.join(distDir, 'tsconfig.build.json');
fs.writeFileSync(buildTsconfig, JSON.stringify({
  compilerOptions: {
    declaration: true,
    emitDeclarationOnly: false,
    outDir: '.',
    rootDir: '../src',
    jsx: 'react-jsx',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    target: 'ES2020',
    lib: ['ES2020', 'DOM', 'DOM.Iterable'],
    esModuleInterop: true,
    skipLibCheck: true,
    strict: false,
    noEmit: false,
    noEmitOnError: false,
    declarationMap: false,
  },
  include: ['../src/**/*.ts', '../src/**/*.tsx'],
  exclude: ['../src/**/*.test.ts', '../src/**/*.test.tsx'],
}, null, 2));

try {
  execSync(`"${bin('tsc')}" -p "${buildTsconfig}"`, { cwd: uiDir, stdio: 'inherit' });
} catch {
  // tsc exits non-zero on type errors even with noEmitOnError:false; the .js/.d.ts
  // are still emitted. Proceed as long as the entry declaration landed.
}
if (!fs.existsSync(path.join(distDir, 'index.d.ts')) || !fs.existsSync(path.join(distDir, 'index.js'))) {
  throw new Error('[build] tsc did not emit dist/index.{js,d.ts} — check the tsc output above');
}

// dist/package.json: makes the converter resolve dist/ as the package root, with
// types + entry it can find. Named so PKG_DIR walks up to it (not packages/ui).
fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify({
  name: '@repo/ui',
  version: '0.0.0',
  types: 'index.d.ts',
  module: 'index.js',
  main: 'index.js',
}, null, 2));

// ── 2. Tailwind CSS ──────────────────────────────────────────────────────────
// The shipped stylesheet must carry the FULL design-token utility surface, not
// just the classes the 22 components happen to use — the design agent composes
// new layouts with the brand/neutral/status tokens (see conventions.md). A
// wrapper config extends the package's real config with a token safelist so
// every token utility is emitted even when no current component references it.
const wrapCfg = path.join(distDir, 'tw.config.ts');
fs.writeFileSync(wrapCfg, `import base from '../tailwind.config';
export default {
  ...base,
  safelist: [
    { pattern: /^(bg|text|border|ring|fill|stroke|from|to)-shiroi-(gold|gold-hover|gold-dark|gold-deep|ink|solar|solar-light|solar-bg|green|green-hover|green-dark|green-deep)$/ },
    { pattern: /^(bg|text|border)-n-(050|100|150|200|300|400|500|600|700|800|900|950)$/ },
    { pattern: /^(bg|text|border)-status-(success|warning|error|info|progress|neutral)-(bg|text|border)$/ },
    { pattern: /^(bg|text|border|ring)-(primary|secondary|destructive|muted|accent|card|popover|background|foreground|input)(-foreground)?$/ },
    { pattern: /^font-(sans|heading|brand|mono)$/ },
    { pattern: /^rounded-(xs|sm|md|lg|xl|full)$/ },
    { pattern: /^shadow-(xs|sm|md|lg)$/ },
  ],
};
`);
const twOut = path.join(distDir, '_compiled-tw.css');
execSync(
  `"${bin('tailwindcss')}" -c "${wrapCfg}" -i src/globals.css -o "${twOut}" --minify`,
  { cwd: uiDir, stdio: 'inherit' }
);
fs.rmSync(wrapCfg, { force: true });
const fontVars = `:root{--font-ibm-plex-sans:'IBM Plex Sans',system-ui,sans-serif;--font-archivo:'Archivo',system-ui,sans-serif;--font-rajdhani:'Rajdhani',system-ui,sans-serif;}\n`;
fs.writeFileSync(path.join(distDir, 'ds.css'), fontVars + fs.readFileSync(twOut, 'utf8'));
fs.rmSync(twOut, { force: true });

const dtsCount = fs.readdirSync(path.join(distDir, 'components')).filter((f) => f.endsWith('.d.ts')).length;
console.error(`[build] dist/index.{js,d.ts} + ${dtsCount} component .d.ts + dist/ds.css (${fs.statSync(path.join(distDir, 'ds.css')).size} bytes)`);
