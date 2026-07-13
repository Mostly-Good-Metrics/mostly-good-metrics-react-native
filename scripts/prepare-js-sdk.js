#!/usr/bin/env node
/*
 * TODO(release): delete this script (and its "prepare" hook) when the
 * @mostly-good-metrics/javascript dependency flips back to the released
 * ^0.8.0, which ships a prebuilt dist/.
 *
 * While the dependency is pinned to a git ref (experiments contract branch,
 * mostly-good-metrics-js PR #45), the installed package contains only src/
 * (no prepare script upstream), so we compile dist/cjs, dist/esm and
 * dist/types here. No-ops if dist/ already exists.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const pkgDir = path.join(rootDir, 'node_modules', '@mostly-good-metrics', 'javascript');

try {
  if (!fs.existsSync(path.join(pkgDir, 'src', 'index.ts'))) {
    process.exit(0); // package not installed (yet) - nothing to do
  }
  if (
    fs.existsSync(path.join(pkgDir, 'dist', 'cjs', 'index.js')) &&
    fs.existsSync(path.join(pkgDir, 'dist', 'types', 'index.d.ts'))
  ) {
    process.exit(0); // already built (or a released version with dist/)
  }

  console.log('[prepare-js-sdk] Building @mostly-good-metrics/javascript from source...');

  // tsc never emits for sources under node_modules (external library files),
  // so compile from a temporary copy of src/ and emit into the package dir.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgm-js-sdk-'));
  fs.cpSync(path.join(pkgDir, 'src'), path.join(tmpDir, 'src'), { recursive: true });

  const entry = path.join(tmpDir, 'src', 'index.ts');
  const common =
    '--target es2018 --lib es2019,dom --types node --moduleResolution node ' +
    '--esModuleInterop --skipLibCheck --strict';
  const out = (sub) => path.join(pkgDir, 'dist', sub);

  const commands = [
    `npx tsc "${entry}" ${common} --module commonjs --outDir "${out('cjs')}"`,
    `npx tsc "${entry}" ${common} --module es2015 --outDir "${out('esm')}"`,
    `npx tsc "${entry}" ${common} --module commonjs --declaration --emitDeclarationOnly --outDir "${out('types')}"`,
  ];

  for (const cmd of commands) {
    execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('[prepare-js-sdk] Done.');
} catch (e) {
  console.warn('[prepare-js-sdk] Failed to build JS SDK dist:', e.message);
  process.exit(1);
}
