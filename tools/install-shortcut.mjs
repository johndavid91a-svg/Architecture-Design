/**
 * Put an Architecture Design icon on the desktop.
 *
 *   npm run desktop-icon
 *
 * Two things can be launched, and this picks whichever exists:
 *
 *   1. A packaged application, if `npm run dist` has been run. Starts like any
 *      other program, no terminal, no Node needed.
 *   2. Otherwise the project itself, via `npm run dev`. Slower to start and it
 *      needs Node on the PATH, but it works straight after `npm install` and it
 *      picks up code changes.
 *
 * The shortcut is written both to the desktop and, where the platform has one,
 * to the applications menu, so it can be found by searching as well as by
 * looking. Nothing outside the user's own home directory is touched.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(repo, 'packages', 'desktop', 'build');
const releaseDir = join(repo, 'packages', 'desktop', 'release');

const APP_NAME = 'Architecture Design';
const COMMENT = 'Digital twin, design and construction estimation';

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/** The desktop folder, which is not always called "Desktop". */
function desktopDir() {
  const home = homedir();
  if (platform() === 'linux') {
    // XDG lets the user rename or relocate it, and on a non-English system it
    // usually is renamed. Ask rather than assume.
    try {
      const found = execFileSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' }).trim();
      if (found && existsSync(found)) return found;
    } catch {
      // xdg-user-dirs is not installed; fall through to the usual place.
    }
  }
  const fallback = join(home, 'Desktop');
  return existsSync(fallback) ? fallback : home;
}

/** The packaged binary, if one has been built. */
function packagedApp() {
  if (!existsSync(releaseDir)) return null;
  const p = platform();

  if (p === 'linux') {
    const unpacked = join(releaseDir, 'linux-unpacked', 'architecture-design');
    if (existsSync(unpacked)) return { kind: 'binary', path: unpacked };
    const appImage = readdirSync(releaseDir).find((f) => f.endsWith('.AppImage'));
    if (appImage) return { kind: 'binary', path: join(releaseDir, appImage) };
  }

  if (p === 'win32') {
    for (const dir of ['win-unpacked', '']) {
      const candidate = join(releaseDir, dir, `${APP_NAME}.exe`);
      if (existsSync(candidate)) return { kind: 'binary', path: candidate };
    }
  }

  if (p === 'darwin') {
    const bundle = join(releaseDir, 'mac', `${APP_NAME}.app`);
    if (existsSync(bundle)) return { kind: 'binary', path: bundle };
    const arm = join(releaseDir, 'mac-arm64', `${APP_NAME}.app`);
    if (existsSync(arm)) return { kind: 'binary', path: arm };
  }

  return null;
}

const target = packagedApp();
const mode = target ? 'the packaged application' : 'the project via npm run dev';
console.log(`\n  ${APP_NAME}`);
console.log(`  Shortcut will start: ${mode}`);

// ---------------------------------------------------------------------------

function installLinux() {
  const icon = join(buildDir, 'icons', '512x512.png');
  if (!existsSync(icon)) fail(`No icon at ${icon}. Run: npm run icons`);

  // Exec must be an absolute command. Launching the project needs a shell so
  // that `cd` and `npm` compose; a packaged binary is run directly.
  const exec = target
    ? `"${target.path}"`
    : `/bin/sh -c "cd '${repo}' && npm run dev"`;

  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${APP_NAME}`,
    `Comment=${COMMENT}`,
    `Exec=${exec}`,
    `Icon=${icon}`,
    `Path=${repo}`,
    'Terminal=false',
    'Categories=Graphics;Engineering;Science;',
    'StartupNotify=true',
    `StartupWMClass=${APP_NAME}`,
    '',
  ].join('\n');

  const written = [];

  const menuDir = join(homedir(), '.local', 'share', 'applications');
  mkdirSync(menuDir, { recursive: true });
  const menuFile = join(menuDir, 'architecture-design.desktop');
  writeFileSync(menuFile, entry, 'utf8');
  chmodSync(menuFile, 0o755);
  written.push(menuFile);

  const deskFile = join(desktopDir(), `${APP_NAME}.desktop`);
  writeFileSync(deskFile, entry, 'utf8');
  chmodSync(deskFile, 0o755);
  written.push(deskFile);

  // GNOME and Cinnamon refuse to run a desktop launcher until it is marked
  // trusted, showing "Untrusted application launcher" instead. This is what
  // marks it; it is not available on every desktop, and its absence is not an
  // error worth failing over.
  try {
    execFileSync('gio', ['set', deskFile, 'metadata::trusted', 'true'], { stdio: 'ignore' });
  } catch {
    /* Not GNOME, or gio is absent. The launcher still works on most desktops. */
  }

  try {
    execFileSync('update-desktop-database', [menuDir], { stdio: 'ignore' });
  } catch {
    /* Optional: only refreshes the menu cache sooner. */
  }

  return written;
}

function installWindows() {
  const icon = join(buildDir, 'icon.ico');
  if (!existsSync(icon)) fail(`No icon at ${icon}. Run: npm run icons`);

  const link = join(desktopDir(), `${APP_NAME}.lnk`);

  // Launching the project needs a shell, and `npm` on Windows is a .cmd that
  // cmd.exe must resolve. `start ""` with a title argument keeps cmd from
  // treating the quoted path as a window title.
  const [targetPath, args] = target
    ? [target.path, '']
    : [process.env.COMSPEC || 'cmd.exe', `/c cd /d "${repo}" && npm run dev`];

  // PowerShell writes the .lnk; there is no way to do it from Node alone.
  const ps = [
    '$ErrorActionPreference = "Stop"',
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + q(link) + ')',
    '$s.TargetPath = ' + q(targetPath),
    args ? '$s.Arguments = ' + q(args) : '',
    '$s.WorkingDirectory = ' + q(repo),
    '$s.IconLocation = ' + q(icon),
    '$s.Description = ' + q(COMMENT),
    (target ? '' : '$s.WindowStyle = 7'), // minimised, so the console keeps out of the way
    '$s.Save()',
  ]
    .filter(Boolean)
    .join('; ');

  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    stdio: 'inherit',
  });

  return [link];
}

/** Single-quote a string for PowerShell. */
function q(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function installMac() {
  // A .command file is what macOS will run from a double-click without needing
  // a signed bundle. For a packaged build the .app already carries the icon and
  // belongs in /Applications, so say that instead of wrapping it.
  if (target) {
    console.log(`\n  Packaged app built at:\n    ${target.path}`);
    console.log('\n  Drag it into /Applications, then it is in Launchpad and Spotlight.');
    console.log('  (A .dmg for handing to someone else: npm run dist)\n');
    return [];
  }

  const file = join(desktopDir(), `${APP_NAME}.command`);
  const script = [
    '#!/bin/sh',
    '# Starts Architecture Design from the project.',
    `cd "${repo}" || exit 1`,
    'exec npm run dev',
    '',
  ].join('\n');
  writeFileSync(file, script, 'utf8');
  chmodSync(file, 0o755);
  return [file];
}

const written =
  platform() === 'linux'
    ? installLinux()
    : platform() === 'win32'
      ? installWindows()
      : platform() === 'darwin'
        ? installMac()
        : fail(`No shortcut support for platform "${platform()}".`);

if (written.length > 0) {
  console.log('\n  Created:');
  for (const file of written) console.log(`    ${file}`);
}

if (!target) {
  console.log('\n  This shortcut runs the project, so it needs Node on the PATH and');
  console.log('  takes a few seconds to start. For a proper standalone application:');
  console.log('\n    npm run dist        then        npm run desktop-icon\n');
} else {
  console.log('');
}
