/**
 * One command, from a fresh clone to an icon on the desktop.
 *
 *   node tools/setup-desktop.mjs
 *
 * Installs dependencies if they are missing, builds the engine, packages the
 * application, and puts a launcher on the desktop and in the applications menu.
 * Each step is skipped if it has already been done, so running this again after
 * a `git pull` is quick.
 *
 * The double-clickable wrappers at the top of the repository call this, so the
 * whole thing is one file to maintain rather than three copies of the same
 * sequence in shell.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = platform() === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

const RULE = '='.repeat(64);
let step = 0;

function heading(text) {
  step += 1;
  console.log(`\n${RULE}\n  Step ${step}: ${text}\n${RULE}`);
}

function note(text) {
  console.log(`  ${text}`);
}

function die(message, hint) {
  console.error(`\n  ${'!'.repeat(60)}`);
  console.error(`  ${message}`);
  if (hint) console.error(`\n  ${hint}`);
  console.error(`  ${'!'.repeat(60)}\n`);
  process.exit(1);
}

function run(args, { optional = false } = {}) {
  const result = spawnSync(npm, args, { cwd: repo, stdio: 'inherit', shell: isWindows });
  if (result.error && result.error.code === 'ENOENT') {
    die(
      'npm was not found.',
      'Install Node.js 20.19 or later from https://nodejs.org and run this again.',
    );
  }
  if (result.status !== 0 && !optional) {
    die(`\`npm ${args.join(' ')}\` failed.`, 'The output above says why.');
  }
  return result.status === 0;
}

// ---------------------------------------------------------------------------

console.log(`\n  Architecture Design — desktop setup`);
console.log(`  ${repo}`);

// --- Node version -----------------------------------------------------------
const major = Number(process.versions.node.split('.')[0]);
const minor = Number(process.versions.node.split('.')[1]);
if (major < 20 || (major === 20 && minor < 19)) {
  die(
    `This project needs Node 20.19 or later. You have ${process.versions.node}.`,
    'Install a newer version from https://nodejs.org and run this again.',
  );
}
note(`Node ${process.versions.node} — fine.`);

// --- Dependencies -----------------------------------------------------------
heading('Dependencies');
if (existsSync(join(repo, 'node_modules', 'electron'))) {
  note('Already installed. Skipping.');
} else {
  note('Downloading. This is the slow part — a few minutes on a first run.');
  run(['install']);
}

// --- Engine -----------------------------------------------------------------
heading('Building the calculation engine');
run(['run', 'build:core']);

// --- Icon -------------------------------------------------------------------
heading('Icon');
if (existsSync(join(repo, 'packages', 'desktop', 'build', 'icon.ico'))) {
  note('Already generated. Skipping.');
} else {
  note('Rendering the icon set.');
  // Needs Electron rather than Node, and a display on Linux. If it cannot run,
  // the committed icons are still there; this only regenerates them.
  run(['run', 'icons'], { optional: true });
}

// --- Application ------------------------------------------------------------
heading('Packaging the application');
const releaseDir = join(repo, 'packages', 'desktop', 'release');
const alreadyPackaged =
  existsSync(releaseDir) &&
  readdirSync(releaseDir).some((f) => /unpacked|\.exe$|\.AppImage$|\.dmg$|^mac/.test(f));

/**
 * Is the packaged application older than the code it was built from?
 *
 * Skipping the build when a package already exists saves several minutes on a
 * re-run, and silently ships the previous version when the source has moved on.
 * That is the worst possible failure here: the user updates, runs this, and gets
 * the identical bug back with no indication why — which is exactly what happened
 * to somebody who updated after a fix and saw the same error, because they were
 * still running the old build.
 */
function packageIsStale() {
  if (!alreadyPackaged) return false;
  const newest = (dir) => {
    let latest = 0;
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'release' || entry.name === 'out') continue;
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else latest = Math.max(latest, statSync(full).mtimeMs);
      }
    };
    try {
      walk(dir);
    } catch {
      /* Unreadable tree: treat as unknown rather than as fresh. */
      return Infinity;
    }
    return latest;
  };

  const built = (() => {
    let earliest = Infinity;
    for (const f of readdirSync(releaseDir)) {
      if (!/unpacked|\.exe$|\.AppImage$|\.dmg$|^mac/.test(f)) continue;
      earliest = Math.min(earliest, statSync(join(releaseDir, f)).mtimeMs);
    }
    return earliest;
  })();

  return newest(join(repo, 'packages')) > built;
}

const stale = packageIsStale();
let packaged = alreadyPackaged && !stale;
if (packaged) {
  note('Already packaged and up to date. Skipping.');
} else {
  if (stale) note('The packaged application is older than the code — rebuilding it.');
  note('Building a standalone application. This downloads Electron — a few minutes.');
  // A failure here is not fatal: the shortcut falls back to starting the
  // project directly, which is slower but works. Better a working icon than
  // no icon.
  packaged = run(['run', 'dist'], { optional: true });
  if (!packaged) {
    note('');
    note('Packaging did not complete. Carrying on — the desktop icon will start');
    note('the project directly instead, which works just as well, only slower.');
  }
}

// --- Shortcut ---------------------------------------------------------------
heading('Desktop icon');
execFileSync(process.execPath, [join(repo, 'tools', 'install-shortcut.mjs')], {
  cwd: repo,
  stdio: 'inherit',
});

console.log(`${RULE}`);
console.log('  Done. Look for "Architecture Design" on your desktop.');
if (isWindows && packaged) {
  console.log('  An installer was also built under packages\\desktop\\release\\.');
}
console.log(`${RULE}\n`);
