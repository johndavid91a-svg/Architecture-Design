/**
 * Rasterise build/icon.svg into the PNG sizes the packagers want.
 *
 * Run with Electron rather than Node, because Chromium is the SVG renderer we
 * already have and it is the same engine that will draw the application. That
 * keeps the icon reproducible from source: nobody has to hand-edit a binary, and
 * regenerating after an edit to the SVG is one command.
 *
 *   npx electron tools/make-icons.cjs
 *
 * electron-builder derives Windows .ico and macOS .icns from build/icon.png, and
 * Linux picks its size out of build/icons/.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'packages', 'desktop', 'build');
const svg = path.join(root, 'icon.svg');
const iconsDir = path.join(root, 'icons');

// 512 is what the packagers convert from; the small sizes are what a Linux
// desktop actually shows in a menu or a task bar.
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  if (!fs.existsSync(svg)) {
    console.error(`No icon source at ${svg}`);
    app.exit(1);
    return;
  }
  fs.mkdirSync(iconsDir, { recursive: true });

  const markup = fs.readFileSync(svg, 'utf8');
  const master = Math.max(...SIZES);

  // Render once at the largest size and resample down, rather than rendering
  // the SVG afresh at each size. One page load is far more reliable, and
  // downsampling a large render keeps thin strokes — the floor lines — visible
  // at 16 px, where rendering natively would drop them below a pixel.
  //
  // The page is written to a file rather than a data URL: the markup is long
  // enough that a data URL fails to load.
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:${master}px;height:${master}px}
  </style></head><body>${markup}</body></html>`;

  const temp = path.join(app.getPath('temp'), `adp-icon-${process.pid}.html`);
  fs.writeFileSync(temp, page, 'utf8');

  const win = new BrowserWindow({
    width: master,
    height: master,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  await win.loadFile(temp);
  // Give the compositor a frame to actually paint before capturing.
  await new Promise((r) => setTimeout(r, 600));
  const full = await win.webContents.capturePage();

  if (full.isEmpty() || full.getSize().width < master) {
    console.error(`Capture came back ${JSON.stringify(full.getSize())}, expected ${master}px square.`);
    app.exit(1);
    return;
  }

  for (const size of SIZES) {
    const image = size === master ? full : full.resize({ width: size, height: size, quality: 'best' });
    const png = image.toPNG();
    fs.writeFileSync(path.join(iconsDir, `${size}x${size}.png`), png);
    if (size === 512) fs.writeFileSync(path.join(root, 'icon.png'), png);
    console.log(`  ${String(size).padStart(4)}px  ${String(png.length).padStart(7)} bytes`);
  }

  // A real multi-size .ico, so Windows shortcuts and the taskbar get a sharp
  // icon at every size rather than one scaled from a single bitmap. The format
  // is a small directory followed by the image blobs; since Vista those blobs
  // may be PNGs, which is what makes this worth writing by hand rather than
  // pulling in a converter.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const blobs = icoSizes.map((size) =>
    fs.readFileSync(path.join(iconsDir, `${size}x${size}.png`)),
  );

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(icoSizes.length, 4);

  const ENTRY = 16;
  let offset = header.length + ENTRY * icoSizes.length;
  const entries = icoSizes.map((size, i) => {
    const entry = Buffer.alloc(ENTRY);
    // 0 means 256 in this field, which is why 256 is the largest an .ico holds.
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(blobs[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += blobs[i].length;
    return entry;
  });

  const ico = Buffer.concat([header, ...entries, ...blobs]);
  fs.writeFileSync(path.join(root, 'icon.ico'), ico);
  console.log(`\n  icon.ico  ${ico.length} bytes (${icoSizes.length} sizes)`);

  win.destroy();
  fs.unlinkSync(temp);

  console.log(`\nWrote ${SIZES.length} sizes to ${iconsDir}`);
  app.quit();
});
