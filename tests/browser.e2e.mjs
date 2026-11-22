import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { readJpegMetadata } from '../src/jpegMetadata.js';
import { parseZipEntries } from '../src/zipWriter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const indexPath = path.join(rootDir, 'index.html');

const BROWSERS = [
  {
    name: 'Google Chrome',
    path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    fullSuite: true,
  },
  {
    name: 'Microsoft Edge',
    path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    fullSuite: false, // Smoke suite covering file:// offline load, crop, and 300-PPI JPEG export
  },
];

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
  });
}

function insertExifOrientation6(jpegBytes) {
  // Verify SOI
  assert.equal(jpegBytes[0], 0xff);
  assert.equal(jpegBytes[1], 0xd8);

  // Build EXIF APP1 (little-endian TIFF IFD0 with 1 tag: Orientation = 6)
  // Length = 4 (FF E1 len) + 6 ("Exif\0\0") + 8 (TIFF header) + 2 (count=1) + 12 (entry) + 4 (next IFD=0) = 36
  const app1 = new Uint8Array(36);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1[2] = 0x00;
  app1[3] = 34; // segLen (excluding 0xFF 0xE1)
  app1.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4); // Exif\0\0
  const t = 10;
  app1.set([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00], t); // II, 42, ifd0 offset 8
  const ifd = t + 8;
  const dv = new DataView(app1.buffer);
  dv.setUint16(ifd, 1, true); // 1 entry
  dv.setUint16(ifd + 2, 0x0112, true); // Orientation
  dv.setUint16(ifd + 4, 3, true); // SHORT
  dv.setUint32(ifd + 6, 1, true); // count 1
  dv.setUint16(ifd + 10, 6, true); // value 6 = Rotate 90 CW
  dv.setUint32(ifd + 14, 0, true); // next IFD = 0

  const out = new Uint8Array(jpegBytes.length + app1.length);
  out.set(jpegBytes.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(jpegBytes.subarray(2), 2 + app1.length);
  return out;
}

async function generateFixtures(page, tmpDir) {
  // Use browser canvas in an isolated page to generate genuine PNG and JPEG fixtures
  const base64Data = await page.evaluate(async () => {
    async function canvasToBase64(w, h, mime, drawFn) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      drawFn(ctx, w, h);
      const blob = await new Promise((res) => c.toBlob(res, mime, 0.96));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]);
      return btoa(bin);
    }

    const syntheticGrid = await canvasToBase64(900, 900, 'image/png', (ctx, w, h) => {
      ctx.fillStyle = '#e62222';
      ctx.fillRect(0, 0, w / 2, h / 2);
      ctx.fillStyle = '#18b83a';
      ctx.fillRect(w / 2, 0, w / 2, h / 2);
      ctx.fillStyle = '#1e50e8';
      ctx.fillRect(0, h / 2, w / 2, h / 2);
      ctx.fillStyle = '#eab308';
      ctx.fillRect(w / 2, h / 2, w / 2, h / 2);

      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 8;
      for (let i = 150; i < 900; i += 150) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(w, i);
        ctx.stroke();
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(400, 400, 100, 100);
    });

    const solidGreen = await canvasToBase64(400, 400, 'image/png', (ctx, w, h) => {
      ctx.fillStyle = '#10b981';
      ctx.fillRect(0, 0, w, h);
    });

    const solidRed = await canvasToBase64(400, 400, 'image/png', (ctx, w, h) => {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(0, 0, w, h);
    });

    const solidNavy = await canvasToBase64(800, 800, 'image/png', (ctx, w, h) => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);
    });

    const transparentMagenta = await canvasToBase64(400, 400, 'image/png', (ctx) => {
      ctx.clearRect(0, 0, 400, 400);
      ctx.fillStyle = '#d946ef';
      ctx.fillRect(140, 140, 120, 120);
    });

    // Landscape 240x120 JPEG: top=RED, bottom=BLUE. With EXIF Orientation=6, displayed portrait has left=BLUE, right=RED.
    const landscapeForExif = await canvasToBase64(240, 120, 'image/jpeg', (ctx) => {
      ctx.fillStyle = '#e11d48';
      ctx.fillRect(0, 0, 240, 60);
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(0, 60, 240, 60);
    });

    return {
      syntheticGrid,
      solidGreen,
      solidRed,
      solidNavy,
      transparentMagenta,
      landscapeForExif,
    };
  });

  const paths = {};
  for (const [key, b64] of Object.entries(base64Data)) {
    const ext = key === 'landscapeForExif' ? 'jpg' : 'png';
    let bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    if (key === 'landscapeForExif') {
      bytes = insertExifOrientation6(bytes);
    }
    const filePath = path.join(tmpDir, `${key}.${ext}`);
    fs.writeFileSync(filePath, bytes);
    paths[key] = filePath;
  }

  const corruptPath = path.join(tmpDir, 'broken.jpg');
  fs.writeFileSync(corruptPath, Buffer.from([0xff, 0xd8, 0x00, 0x11, 0x22, 0x33]));
  paths.corrupt = corruptPath;

  const dupDir = path.join(tmpDir, 'dup');
  fs.mkdirSync(dupDir, { recursive: true });
  const dupPath = path.join(dupDir, 'solidGreen.png');
  fs.copyFileSync(paths.solidGreen, dupPath);
  paths.dupGreen = dupPath;

  return paths;
}

async function decodeJpegPixelsInBrowser(page, jpegBytes) {
  const b64 = Buffer.from(jpegBytes).toString('base64');
  return page.evaluate(async (encoded) => {
    const bin = atob(encoded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    const sampleAt = (normX, normY) => {
      const px = Math.min(c.width - 1, Math.max(0, Math.round(normX * (c.width - 1))));
      const py = Math.min(c.height - 1, Math.max(0, Math.round(normY * (c.height - 1))));
      const d = ctx.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2]];
    };

    return {
      width: c.width,
      height: c.height,
      samplePoints: [
        sampleAt(0.15, 0.15),
        sampleAt(0.85, 0.15),
        sampleAt(0.5, 0.5),
        sampleAt(0.15, 0.85),
        sampleAt(0.85, 0.85),
      ],
      corners: [
        sampleAt(0.01, 0.01),
        sampleAt(0.99, 0.01),
        sampleAt(0.01, 0.99),
        sampleAt(0.99, 0.99),
      ],
      leftMid: sampleAt(0.25, 0.5),
      rightMid: sampleAt(0.75, 0.5),
    };
  }, b64);
}

async function samplePreviewMaskPoints(page) {
  return page.evaluate(() => {
    const mask = document.querySelector('[data-testid="mask-frame"]');
    const canvas = document.querySelector('.stage-canvas');
    if (!mask || !canvas) return null;
    const x = parseFloat(mask.dataset.maskX);
    const y = parseFloat(mask.dataset.maskY);
    const w = parseFloat(mask.dataset.maskW);
    const h = parseFloat(mask.dataset.maskH);
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');

    const sampleAt = (normX, normY) => {
      const px = Math.round((x + normX * w) * dpr);
      const py = Math.round((y + normY * h) * dpr);
      const d = ctx.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2]];
    };

    return [
      sampleAt(0.15, 0.15),
      sampleAt(0.85, 0.15),
      sampleAt(0.5, 0.5),
      sampleAt(0.15, 0.85),
      sampleAt(0.85, 0.85),
    ];
  });
}

async function runDownloadAndReadBytes(page, triggerAction) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    triggerAction(),
  ]);
  const dlPath = await download.path();
  return {
    filename: download.suggestedFilename(),
    bytes: new Uint8Array(fs.readFileSync(dlPath)),
  };
}

async function attachGuardrails(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const externalRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  await page.route('**/*', (route) => {
    const reqUrl = route.request().url();
    if (
      reqUrl.startsWith('file://') ||
      reqUrl.startsWith('http://127.0.0.1:') ||
      reqUrl.startsWith('blob:') ||
      reqUrl.startsWith('data:')
    ) {
      route.continue();
    } else {
      externalRequests.push(reqUrl);
      route.abort();
    }
  });

  return { consoleErrors, pageErrors, externalRequests };
}

async function runEdgeSmoke(executablePath, fileUrl, fixtures) {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, acceptDownloads: true });
    const page = await context.newPage();
    const guards = await attachGuardrails(page);

    await page.goto(fileUrl, { waitUntil: 'load' });
    await page.waitForSelector('h1');

    // Standards mode check
    const compatMode = await page.evaluate(() => document.compatMode);
    assert.equal(compatMode, 'CSS1Compat');

    await page.setInputFiles('#file-upload', fixtures.syntheticGrid);
    await page.waitForSelector('[data-testid="mask-frame"]');

    const dl = await runDownloadAndReadBytes(page, () =>
      page.click('button:has-text("Download 10×15 cm Crop")')
    );
    const meta = readJpegMetadata(dl.bytes);
    assert.equal(meta.sof.width, 1181);
    assert.equal(meta.sof.height, 1772);
    assert.equal(meta.jfif.xDensity, 300);

    assert.deepEqual(guards.externalRequests, []);
    assert.deepEqual(guards.pageErrors, []);
    assert.deepEqual(guards.consoleErrors, []);
    await context.close();
  } finally {
    await browser.close();
  }
}

async function runChromeFullSuite(executablePath, fileUrl, httpUrl, fixtures) {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    // 1. Offline file:// verification (loads cleanly, zero external requests)
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
      const page = await ctx.newPage();
      const guards = await attachGuardrails(page);
      await page.goto(fileUrl, { waitUntil: 'load' });
      assert.equal(await page.evaluate(() => document.compatMode), 'CSS1Compat');
      assert.equal(await page.locator('[data-testid="output-spec"]').innerText(), 'Output: 10 × 15 cm • 1181 × 1772 px @ 300 PPI JPEG');
      assert.deepEqual(guards.externalRequests, []);
      assert.deepEqual(guards.pageErrors, []);
      assert.deepEqual(guards.consoleErrors, []);
      await ctx.close();
    }

    // 2. Full workflow suite over local http://127.0.0.1
    const context = await browser.newContext({
      viewport: { width: 1280, height: 820 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const guards = await attachGuardrails(page);
    await page.goto(httpUrl, { waitUntil: 'load' });

    // #1, #2, #3, #4: Desktop layout + Presets, Landscape, Custom validation
    assert.equal(await page.getAttribute('.app-shell', 'data-layout-mode'), 'desktop');
    const desktopBoxes = await page.evaluate(() => {
      const aside = document.querySelector('.sidebar').getBoundingClientRect();
      const stage = document.querySelector('.stage-main').getBoundingClientRect();
      return { asideRight: aside.right, stageLeft: stage.left };
    });
    assert.ok(desktopBoxes.asideRight <= desktopBoxes.stageLeft + 2);

    await page.click('button:has-text("Landscape")');
    assert.match(await page.locator('[data-testid="output-spec"]').innerText(), /1772 × 1181 px/);
    await page.selectOption('#preset-select', '13x18');
    assert.match(await page.locator('[data-testid="output-spec"]').innerText(), /2126 × 1535 px/);
    await page.click('button:has-text("Portrait")');
    assert.match(await page.locator('[data-testid="output-spec"]').innerText(), /1535 × 2126 px/);

    await page.selectOption('#preset-select', 'custom');
    await page.fill('#custom-width-input', '20');
    await page.fill('#custom-height-input', '10');
    assert.match(await page.locator('[data-testid="output-spec"]').innerText(), /20 × 10 cm • 2362 × 1181 px/);
    await page.click('button[aria-label="Swap custom width and height"]');
    assert.match(await page.locator('[data-testid="output-spec"]').innerText(), /10 × 20 cm • 1181 × 2362 px/);

    // #9: Invalid inputs stay visible in raw input and disable export before canvas allocation
    for (const badVal of ['', '-5', '100', 'abc']) {
      await page.fill('#custom-width-input', badVal);
      assert.equal(await page.inputValue('#custom-width-input'), badVal);
      assert.ok(await page.locator('.sidebar [role="alert"]').count() >= 1);
    }

    await page.fill('#custom-width-input', '10');
    await page.selectOption('#preset-select', '10x15');
    await page.click('button:has-text("Portrait")');

    // #5 & #6 & #16: Upload synthetic grid, pan & zoom, resize window, verify preview == export pixels & 300 PPI JPEG
    await page.setInputFiles('#file-upload', fixtures.syntheticGrid);
    await page.waitForSelector('[data-testid="mask-frame"]');

    await page.fill('#zoom-slider', '1.6');
    const maskBox = await page.locator('.viewport-container').boundingBox();
    await page.mouse.move(maskBox.x + maskBox.width / 2, maskBox.y + maskBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(maskBox.x + maskBox.width / 2 - 45, maskBox.y + maskBox.height / 2 + 30, { steps: 4 });
    await page.mouse.up();

    const cropBeforeResize = await page.evaluate(() => {
      const m = document.querySelector('[data-testid="mask-frame"]');
      return { cx: m.dataset.cropCx, cy: m.dataset.cropCy, zoom: m.dataset.cropZoom };
    });

    await page.setViewportSize({ width: 920, height: 640 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 80)))));

    const cropAfterResize = await page.evaluate(() => {
      const m = document.querySelector('[data-testid="mask-frame"]');
      return { cx: m.dataset.cropCx, cy: m.dataset.cropCy, zoom: m.dataset.cropZoom };
    });
    assert.deepEqual(cropAfterResize, cropBeforeResize);

    // Effective source PPI warning is visible for 900x900 px image at 10x15 cm zoom 1.6x
    assert.match(await page.locator('[data-testid="ppi-status"]').innerText(), /Below 300 PPI/);

    if (process.env.SPC_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.SPC_SCREENSHOT_DIR, 'desktop.png') });
    }

    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const previewPts = await samplePreviewMaskPoints(page);
    const dlGrid = await runDownloadAndReadBytes(page, () =>
      page.click('button:has-text("Download 10×15 cm Crop")')
    );
    assert.match(dlGrid.filename, /^syntheticGrid_10x15cm_300dpi\.jpg$/);

    const gridMeta = readJpegMetadata(dlGrid.bytes);
    assert.equal(gridMeta.valid, true);
    assert.equal(gridMeta.sof.width, 1181);
    assert.equal(gridMeta.sof.height, 1772);
    assert.equal(gridMeta.jfif.units, 1);
    assert.equal(gridMeta.jfif.xDensity, 300);
    assert.equal(gridMeta.jfif.yDensity, 300);

    const exportPixels = await decodeJpegPixelsInBrowser(page, dlGrid.bytes);
    for (let i = 0; i < previewPts.length; i += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        const diff = Math.abs(previewPts[i][ch] - exportPixels.samplePoints[i][ch]);
        assert.ok(diff <= 18, `Preview/export mismatch at point ${i} channel ${ch}: ${previewPts[i][ch]} vs ${exportPixels.samplePoints[i][ch]}`);
      }
    }

    // #10: Corrupt upload + simulated null getContext + null toBlob recovery
    await page.setInputFiles('#file-upload', fixtures.corrupt);
    await page.waitForSelector('.batch-badge.is-error');
    await page.click('.batch-select-btn >> nth=0'); // Back to syntheticGrid

    await page.evaluate(() => {
      window.__origCreateElement = document.createElement.bind(document);
      document.createElement = function patched(tag) {
        const el = window.__origCreateElement(tag);
        if (String(tag).toLowerCase() === 'canvas') {
          el.getContext = () => null;
        }
        return el;
      };
    });
    await page.click('button:has-text("Download 10×15 cm Crop")');
    assert.match(await page.locator('[data-testid="global-error"]').innerText(), /canvas context/i);
    assert.equal(await page.isDisabled('button:has-text("Download 10×15 cm Crop")'), false);

    await page.evaluate(() => {
      document.createElement = window.__origCreateElement;
      window.__origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function patchedToBlob(cb) {
        cb(null);
      };
    });
    await page.click('button:has-text("Download 10×15 cm Crop")');
    assert.match(await page.locator('[data-testid="global-error"]').innerText(), /encoding failed/i);
    assert.equal(await page.isDisabled('button:has-text("Download 10×15 cm Crop")'), false);

    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = window.__origToBlob;
    });

    // Clear batch cleanly before next tests
    await page.click('button:has-text("Clear All")');
    assert.equal(await page.locator('.batch-item-row').count(), 0);

    // #7: Rapid switching with delayed decode must not overwrite active preview
    await page.evaluate(() => {
      window.__origDecode = HTMLImageElement.prototype.decode;
      let first = true;
      HTMLImageElement.prototype.decode = function delayedDecode() {
        const origPromise = window.__origDecode ? window.__origDecode.call(this) : Promise.resolve();
        if (first) {
          first = false;
          return origPromise.then(() => new Promise((r) => setTimeout(r, 350)));
        }
        return origPromise;
      };
    });
    await page.setInputFiles('#file-upload', [fixtures.solidRed, fixtures.solidGreen]);
    await page.waitForFunction(() => {
      const btns = document.querySelectorAll('.batch-select-btn');
      return btns.length === 2 && !btns[1].querySelector('.batch-badge');
    });
    await page.click('.batch-select-btn >> nth=1'); // Select solidGreen while solidRed decode was delayed
    await page.waitForTimeout(450);
    const racePts = await samplePreviewMaskPoints(page);
    // Green (#10b981 -> G > R)
    assert.ok(racePts[2][1] > racePts[2][0] + 40, `Expected green center pixel, got ${racePts[2]}`);
    await page.evaluate(() => {
      HTMLImageElement.prototype.decode = window.__origDecode;
    });

    // #8: Export remains fixed to click-time snapshot while user edits mid-export
    await page.evaluate(() => {
      window.__origToBlob2 = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function delayedToBlob(cb, mime, q) {
        setTimeout(() => {
          window.__origToBlob2.call(this, cb, mime, q);
        }, 250);
      };
    });
    const dlSnapshotPromise = runDownloadAndReadBytes(page, () =>
      page.click('button:has-text("Download 10×15 cm Crop")')
    );
    await page.waitForTimeout(40);
    // User switches dimensions mid-flight!
    await page.selectOption('#preset-select', '13x18');
    await page.click('button:has-text("Landscape")');
    const dlSnapshot = await dlSnapshotPromise;
    const snapMeta = readJpegMetadata(dlSnapshot.bytes);
    assert.equal(snapMeta.sof.width, 1181);
    assert.equal(snapMeta.sof.height, 1772);
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = window.__origToBlob2;
    });

    // Restore 10x15 Portrait and clear
    await page.selectOption('#preset-select', '10x15');
    await page.click('button:has-text("Portrait")');
    await page.click('button:has-text("Clear All")');

    // #11: Fill vs White Borders
    await page.setInputFiles('#file-upload', fixtures.solidNavy);
    await page.waitForSelector('[data-testid="mask-frame"]');
    const dlFill = await runDownloadAndReadBytes(page, () =>
      page.click('button:has-text("Download 10×15 cm Crop")')
    );
    const fillPx = await decodeJpegPixelsInBrowser(page, dlFill.bytes);
    for (const c of fillPx.corners) {
      assert.ok(c[0] < 60 && c[1] < 60 && c[2] < 80, `Expected dark navy corner in Fill mode, got ${c}`);
    }

    await page.click('button:has-text("White Borders")');
    await page.fill('#zoom-slider', '0.5');
    const dlBorder = await runDownloadAndReadBytes(page, () =>
      page.click('button:has-text("Download 10×15 cm Crop")')
    );
    const borderPx = await decodeJpegPixelsInBrowser(page, dlBorder.bytes);
    for (const c of borderPx.corners) {
      assert.ok(c[0] > 240 && c[1] > 240 && c[2] > 240, `Expected white corner in Borders mode, got ${c}`);
    }
    assert.ok(borderPx.samplePoints[2][0] < 60, `Expected dark navy center in Borders mode, got ${borderPx.samplePoints[2]}`);

    await page.click('button:has-text("Clear All")');

    // #12: Portrait phone EXIF Orientation=6 JPEG (no double rotation)
    await page.setInputFiles('#file-upload', fixtures.landscapeForExif);
    await page.waitForSelector('[data-testid="mask-frame"]');
    const dlExif = await runDownloadAndReadBytes(page, () =>
      page.click('button:has-text("Download 10×15 cm Crop")')
    );
    const exifPx = await decodeJpegPixelsInBrowser(page, dlExif.bytes);
    assert.ok(exifPx.leftMid[2] > 180 && exifPx.leftMid[0] < 80, `Expected BLUE on left after EXIF 6 orientation, got ${exifPx.leftMid}`);
    assert.ok(exifPx.rightMid[0] > 180 && exifPx.rightMid[2] < 80, `Expected RED on right after EXIF 6 orientation, got ${exifPx.rightMid}`);

    await page.click('button:has-text("Clear All")');

    // #13: Transparent PNG composites onto white
    await page.setInputFiles('#file-upload', fixtures.transparentMagenta);
    await page.waitForSelector('[data-testid="mask-frame"]');
    const dlTrans = await runDownloadAndReadBytes(page, () =>
      page.click('button:has-text("Download 10×15 cm Crop")')
    );
    const transPx = await decodeJpegPixelsInBrowser(page, dlTrans.bytes);
    for (const c of transPx.corners) {
      assert.ok(c[0] > 240 && c[1] > 240 && c[2] > 240, `Expected white background on transparent PNG, got ${c}`);
    }
    assert.ok(transPx.samplePoints[2][0] > 180 && transPx.samplePoints[2][2] > 180 && transPx.samplePoints[2][1] < 100);

    // #14: Remove & re-upload the exact same file
    await page.click('button[aria-label="Remove transparentMagenta.png"]');
    assert.equal(await page.locator('.batch-item-row').count(), 0);
    await page.setInputFiles('#file-upload', fixtures.transparentMagenta);
    await page.waitForSelector('[data-testid="mask-frame"]');
    assert.equal(await page.locator('.batch-item-row').count(), 1);
    await page.click('button:has-text("Clear All")');

    // #15: Adaptive portrait/mobile layout, zero horizontal scroll, tabs, collapsible sections, touch & keyboard
    // First confirm portrait tablet (800x1024) enters adaptive portrait mode
    await page.setViewportSize({ width: 800, height: 1024 });
    await page.waitForFunction(() => document.querySelector('.app-shell')?.getAttribute('data-layout-mode') === 'mobile');
    assert.equal(await page.getAttribute('.app-shell', 'data-layout-mode'), 'mobile');

    // Switch to phone portrait (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.app-shell')?.getAttribute('data-layout-mode') === 'mobile');
    assert.equal(await page.getAttribute('.app-shell', 'data-layout-mode'), 'mobile');
    assert.equal(await page.getAttribute('[data-testid="tab-photos"]', 'aria-selected'), 'true');

    await page.setInputFiles('#file-upload', fixtures.syntheticGrid);
    await page.waitForSelector('[data-testid="mask-frame"]');

    // Smart switch moves to Crop & Save tab once first photo finishes loading
    assert.equal(await page.getAttribute('[data-testid="tab-crop"]', 'aria-selected'), 'true');

    // Pinned viewing stage stays above tabbed controls
    const mobileGeo = await page.evaluate(() => {
      const stage = document.querySelector('.stage-main').getBoundingClientRect();
      const dock = document.querySelector('.mobile-dock').getBoundingClientRect();
      const vp = document.querySelector('.viewport-container').getBoundingClientRect();
      return {
        stageBottom: stage.bottom,
        dockTop: dock.top,
        vpWidth: vp.width,
        vpHeight: vp.height,
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
      };
    });
    assert.ok(mobileGeo.vpHeight >= 215 && mobileGeo.vpWidth >= 300);
    assert.ok(mobileGeo.stageBottom <= mobileGeo.dockTop + 2);
    assert.ok(mobileGeo.scrollW <= mobileGeo.innerW, `Horizontal overflow on crop tab: ${mobileGeo.scrollW} > ${mobileGeo.innerW}`);

    // Verify collapsible sections inside Crop & Save while viewing window remains visible
    assert.equal(await page.getAttribute('[data-testid="collapse-toggle-crop-mode"]', 'aria-expanded'), 'false');
    await page.click('[data-testid="collapse-toggle-crop-mode"]');
    assert.equal(await page.getAttribute('[data-testid="collapse-toggle-crop-mode"]', 'aria-expanded'), 'true');
    await page.click('button:has-text("White Borders")');
    await page.click('button:has-text("Fill (Borderless)")');

    if (process.env.SPC_SCREENSHOT_DIR) {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(process.env.SPC_SCREENSHOT_DIR, 'mobile-crop.png') });
    }

    await page.locator('.viewport-container').focus();
    await page.keyboard.press('+');
    assert.equal(await page.locator('[data-testid="zoom-readout"]').innerText(), '110%');

    // Touch pointer pan verification
    const touchCxBefore = parseFloat(await page.locator('[data-testid="mask-frame"]').getAttribute('data-crop-cx'));
    await page.evaluate(() => {
      const vp = document.querySelector('.viewport-container');
      const rect = vp.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      vp.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }));
      vp.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x + 35, clientY: y }));
      vp.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x + 35, clientY: y }));
    });
    const touchCxAfter = parseFloat(await page.locator('[data-testid="mask-frame"]').getAttribute('data-crop-cx'));
    assert.notEqual(touchCxAfter, touchCxBefore);

    await page.keyboard.press('ArrowRight');
    const pannedCx = parseFloat(await page.locator('[data-testid="mask-frame"]').getAttribute('data-crop-cx'));
    assert.notEqual(pannedCx, touchCxAfter);
    await page.keyboard.press('0');
    assert.equal(await page.locator('[data-testid="zoom-readout"]').innerText(), '100%');

    // Check Size tab + collapsible specs + narrow 320px Custom Size with zero horizontal scroll
    await page.click('[data-testid="tab-size"]');
    assert.equal(await page.getAttribute('[data-testid="collapse-toggle-size-specs"]', 'aria-expanded'), 'false');
    await page.click('[data-testid="collapse-toggle-size-specs"]');
    assert.equal(await page.getAttribute('[data-testid="collapse-toggle-size-specs"]', 'aria-expanded'), 'true');
    assert.match(await page.locator('[data-testid="output-spec"]').innerText(), /1181 × 1772 px/);
    await page.selectOption('#preset-select', 'custom');
    if (process.env.SPC_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.SPC_SCREENSHOT_DIR, 'mobile-size.png') });
    }
    await page.setViewportSize({ width: 320, height: 640 });
    const overflow320 = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    assert.ok(overflow320.scrollW <= overflow320.innerW, `Horizontal overflow at 320px: ${overflow320.scrollW} > ${overflow320.innerW}`);

    // Restore preset and test Photos tab + zero horizontal overflow
    await page.selectOption('#preset-select', '10x15');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('[data-testid="tab-photos"]');
    const photosOverflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    assert.ok(photosOverflow.scrollW <= photosOverflow.innerW);
    if (process.env.SPC_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.SPC_SCREENSHOT_DIR, 'mobile-photos.png') });
    }

    await page.click('button:has-text("Clear All")');

    // #17: Batch ZIP with duplicate filenames + 1 corrupt file + batch cancellation check
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.waitForFunction(() => document.querySelector('.app-shell')?.getAttribute('data-layout-mode') === 'desktop');
    assert.equal(await page.getAttribute('.app-shell', 'data-layout-mode'), 'desktop');
    await page.setInputFiles('#file-upload', [fixtures.solidGreen, fixtures.dupGreen, fixtures.corrupt]);
    await page.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Download All Ready (2)'));
      return Boolean(btn && !btn.disabled);
    });

    // Verify batch cancellation between items
    await page.evaluate(() => {
      window.__origToBlobCancel = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function slowToBlob(cb, mime, q) {
        setTimeout(() => {
          window.__origToBlobCancel.call(this, cb, mime, q);
        }, 220);
      };
    });
    await page.click('button:has-text("Download All Ready (2) as ZIP")');
    await page.waitForSelector('button:has-text("Cancel Batch Export")');
    await page.click('button:has-text("Cancel Batch Export")');
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-testid="status-message"]')?.textContent || '';
      return status.includes('Batch export cancelled');
    });
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = window.__origToBlobCancel;
    });

    const dlZip = await runDownloadAndReadBytes(page, () =>
      page.click('button:has-text("Download All Ready (2) as ZIP")')
    );
    assert.match(dlZip.filename, /\.zip$/);
    const zipEntries = parseZipEntries(dlZip.bytes);
    assert.equal(zipEntries.length, 2);
    assert.equal(zipEntries[0].name, 'solidGreen_10x15cm_300dpi.jpg');
    assert.equal(zipEntries[1].name, 'solidGreen_10x15cm_300dpi_2.jpg');
    for (const entry of zipEntries) {
      const m = readJpegMetadata(entry.data);
      assert.equal(m.valid, true);
      assert.equal(m.sof.width, 1181);
      assert.equal(m.sof.height, 1772);
      assert.equal(m.jfif.xDensity, 300);
    }

    // Assert zero unexpected errors & zero external network calls across entire run
    assert.deepEqual(guards.externalRequests, []);
    assert.deepEqual(guards.pageErrors, []);
    assert.deepEqual(guards.consoleErrors, []);

    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spc-e2e-'));
  const fileUrl = pathToFileURL(indexPath).href;
  const { server, url: httpUrl } = await startStaticServer();

  try {
    const chrome = BROWSERS.find((b) => fs.existsSync(b.path) && b.fullSuite);
    assert.ok(chrome, 'Google Chrome executable not found for E2E verification.');

    const setupBrowser = await chromium.launch({ executablePath: chrome.path, headless: true });
    let fixtures;
    try {
      const setupPage = await setupBrowser.newPage();
      fixtures = await generateFixtures(setupPage, tmpDir);
    } finally {
      await setupBrowser.close();
    }

    for (const b of BROWSERS) {
      if (!fs.existsSync(b.path)) {
        console.log(`Skipping unavailable browser: ${b.name}`);
        continue;
      }
      if (b.fullSuite) {
        console.log(`Running full browser E2E suite in ${b.name}...`);
        await runChromeFullSuite(b.path, fileUrl, httpUrl, fixtures);
      } else {
        console.log(`Running offline file:// smoke check in ${b.name}...`);
        await runEdgeSmoke(b.path, fileUrl, fixtures);
      }
      console.log(`PASS: ${b.name}`);
    }
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
