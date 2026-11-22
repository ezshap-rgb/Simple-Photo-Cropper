import test from 'node:test';
import assert from 'node:assert/strict';

import { DPI, FIT_MODES } from '../src/constants.js';
import {
  DEFAULT_CROP,
  adaptCropForAspectChange,
  applyPanDelta,
  clampCrop,
  computeEffectiveSourcePpi,
  computeImageDrawRect,
  computeStageLayout,
  getOutputPixelDimensions,
  getVisibleSourceRect,
  resolveEffectiveDimensions,
} from '../src/geometry.js';
import {
  buildExportFilename,
  parseCustomCm,
  validateOutputDimensions,
} from '../src/validation.js';
import { readJpegMetadata, setJpegDpi } from '../src/jpegMetadata.js';
import { createStoreZip, parseZipEntries } from '../src/zipWriter.js';

function makeMinimalJpeg({ withJfif = true, xDpi = 72, yDpi = 72, width = 100, height = 200, withExif = false } = {}) {
  const chunks = [];
  chunks.push(new Uint8Array([0xff, 0xd8])); // SOI

  if (withJfif) {
    const app0 = new Uint8Array([
      0xff, 0xe0, 0x00, 0x10,
      0x4a, 0x46, 0x49, 0x46, 0x00, // JFIF\0
      0x01, 0x01, 0x01,
      (xDpi >> 8) & 0xff, xDpi & 0xff,
      (yDpi >> 8) & 0xff, yDpi & 0xff,
      0x00, 0x00,
    ]);
    chunks.push(app0);
  }

  if (withExif) {
    // Little-endian TIFF IFD0 with 3 entries: XResolution (0x011A), YResolution (0x011B), ResolutionUnit (0x0128)
    const app1 = new Uint8Array(4 + 6 + 8 + 2 + 3 * 12 + 4 + 16);
    app1[0] = 0xff;
    app1[1] = 0xe1;
    const payloadLen = app1.length - 2;
    app1[2] = (payloadLen >> 8) & 0xff;
    app1[3] = payloadLen & 0xff;
    // Exif\0\0
    app1.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);
    const t = 10; // tiff start
    app1.set([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00], t); // II, 42, ifd0=8
    const ifd = t + 8;
    app1[ifd] = 3; // 3 entries
    const dv = new DataView(app1.buffer);
    // Entry 0: XResolution -> offset 50 (relative to t)
    dv.setUint16(ifd + 2, 0x011a, true);
    dv.setUint16(ifd + 4, 5, true);
    dv.setUint32(ifd + 6, 1, true);
    dv.setUint32(ifd + 10, 50, true);
    // Entry 1: YResolution -> offset 58
    dv.setUint16(ifd + 14, 0x011b, true);
    dv.setUint16(ifd + 16, 5, true);
    dv.setUint32(ifd + 18, 1, true);
    dv.setUint32(ifd + 22, 58, true);
    // Entry 2: ResolutionUnit = 2
    dv.setUint16(ifd + 26, 0x0128, true);
    dv.setUint16(ifd + 28, 3, true);
    dv.setUint32(ifd + 30, 1, true);
    dv.setUint16(ifd + 34, 2, true);
    // Initial 72/1 values at t+50, t+58
    dv.setUint32(t + 50, 72, true);
    dv.setUint32(t + 54, 1, true);
    dv.setUint32(t + 58, 72, true);
    dv.setUint32(t + 62, 1, true);
    chunks.push(app1);
  }

  // SOF0 marker (0xC0) with height & width
  chunks.push(new Uint8Array([
    0xff, 0xc0, 0x00, 0x0b,
    0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  ]));

  // SOS + entropy bytes + EOI
  chunks.push(new Uint8Array([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xaa, 0xbb, 0xff, 0xd9]));

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

test('Validation #1, #2, #3: preset portrait and landscape pixel dimensions', () => {
  const p10 = resolveEffectiveDimensions({ preset: '10x15', orientation: 'portrait' });
  assert.deepEqual(getOutputPixelDimensions(p10.widthCm, p10.heightCm, DPI), { widthPx: 1181, heightPx: 1772 });

  const l10 = resolveEffectiveDimensions({ preset: '10x15', orientation: 'landscape' });
  assert.deepEqual(getOutputPixelDimensions(l10.widthCm, l10.heightCm, DPI), { widthPx: 1772, heightPx: 1181 });

  const p13 = resolveEffectiveDimensions({ preset: '13x18', orientation: 'portrait' });
  assert.deepEqual(getOutputPixelDimensions(p13.widthCm, p13.heightCm, DPI), { widthPx: 1535, heightPx: 2126 });

  const l13 = resolveEffectiveDimensions({ preset: '13x18', orientation: 'landscape' });
  assert.deepEqual(getOutputPixelDimensions(l13.widthCm, l13.heightCm, DPI), { widthPx: 2126, heightPx: 1535 });
});

test('Validation #4: custom dimensions stay true to entered Width and Height without hidden inversion', () => {
  const custom = resolveEffectiveDimensions({
    preset: 'custom',
    orientation: 'landscape', // should never invert custom dimensions
    customWidthCm: 20,
    customHeightCm: 10,
  });
  assert.equal(custom.widthCm, 20);
  assert.equal(custom.heightCm, 10);
});

test('Validation #5 & #6: resize preserves source crop and preview/export draw geometry agrees', () => {
  const srcW = 3000;
  const srcH = 2000;
  const targetAspect = 1181 / 1772;
  const crop = clampCrop({ centerX: 0.42, centerY: 0.57, zoom: 1.8 }, srcW, srcH, targetAspect, FIT_MODES.FILL);

  const stageA = computeStageLayout(1000, 800, targetAspect);
  const stageB = computeStageLayout(360, 420, targetAspect);
  assert.ok(stageA && stageB);

  const exportRect = { x: 0, y: 0, width: 1181, height: 1772 };
  const drawA = computeImageDrawRect(srcW, srcH, stageA.maskRect, crop);
  const drawB = computeImageDrawRect(srcW, srcH, stageB.maskRect, crop);
  const drawExp = computeImageDrawRect(srcW, srcH, exportRect, crop);

  // Source region mapped into maskRect is completely invariant across viewport resizes and export
  assert.deepEqual(drawA.visibleSourceRect, drawB.visibleSourceRect);
  assert.deepEqual(drawA.visibleSourceRect, drawExp.visibleSourceRect);

  // Zero-sized or hidden stage returns null safely
  assert.equal(computeStageLayout(0, 500, targetAspect), null);
  assert.equal(computeStageLayout(400, 0, targetAspect), null);
});

test('Validation #9: invalid dimensions are rejected with clear errors before canvas allocation', () => {
  for (const bad of ['', '   ', 'abc', '0', '-5', '0.5', '100', 'NaN', 'Infinity']) {
    const parsed = parseCustomCm(bad, 'Width');
    assert.equal(parsed.valid, false, `Expected "${bad}" to be rejected`);
    assert.ok(parsed.error.length > 0);
  }
  assert.equal(parseCustomCm('12.5', 'Width').valid, true);
  assert.equal(parseCustomCm('12.5', 'Width').value, 12.5);

  assert.equal(validateOutputDimensions(100, 10).valid, false);
  assert.equal(validateOutputDimensions(65, 65).valid, false); // 7677*7677 = 58.9M > 33.5M px limit
  assert.equal(validateOutputDimensions(20, 30).valid, true);
});

test('Validation #11 & effective PPI: Fill prevents exposed edges; White borders permits zoom-out', () => {
  const srcW = 1600;
  const srcH = 1200;
  const aspect = 10 / 15;
  const stage = computeStageLayout(800, 800, aspect);

  // Fill clamps zoom >= 1 and keeps visible source rect inside [0..srcW, 0..srcH]
  let fillCrop = clampCrop({ centerX: 0.5, centerY: 0.5, zoom: 0.4 }, srcW, srcH, aspect, FIT_MODES.FILL);
  assert.equal(fillCrop.zoom, 1.0);
  fillCrop = applyPanDelta(fillCrop, 5000, 5000, srcW, srcH, stage.maskRect, FIT_MODES.FILL);
  const visFill = getVisibleSourceRect(srcW, srcH, aspect, fillCrop);
  assert.ok(visFill.left >= -1e-6);
  assert.ok(visFill.top >= -1e-6);
  assert.ok(visFill.left + visFill.width <= srcW + 1e-6);
  assert.ok(visFill.top + visFill.height <= srcH + 1e-6);

  // White borders allows zoom < 1 and intentional margin
  const borderCrop = clampCrop({ centerX: 0.5, centerY: 0.5, zoom: 0.4 }, srcW, srcH, aspect, FIT_MODES.BORDERS);
  assert.equal(borderCrop.zoom, 0.4);
  const visBorders = getVisibleSourceRect(srcW, srcH, aspect, borderCrop);
  assert.ok(visBorders.left < 0 && visBorders.top < 0);

  // Aspect change preserves focal center where valid and clamps cleanly
  const adapted = adaptCropForAspectChange(borderCrop, srcW, srcH, 15 / 10, FIT_MODES.FILL);
  assert.equal(adapted.zoom, 1.0);

  // Effective PPI calculation reflects zoomed source pixels over physical print cm
  const ppiFull = computeEffectiveSourcePpi(1800, 2700, 10, 15, DEFAULT_CROP, DPI);
  assert.ok(ppiFull.roundedPpi > 450 && !ppiFull.isBelowTarget);
  const ppiLow = computeEffectiveSourcePpi(1800, 2700, 10, 15, { centerX: 0.5, centerY: 0.5, zoom: 2.0 }, DPI);
  assert.ok(ppiLow.roundedPpi < 240 && ppiLow.isBelowTarget);
});

test('Validation #16: JPEG segment parser/writer sets 300 PPI without corrupting scan data', () => {
  for (const opts of [
    { withJfif: true, xDpi: 72, yDpi: 72, width: 1181, height: 1772 },
    { withJfif: false, width: 1535, height: 2126 },
    { withJfif: true, withExif: true, xDpi: 96, yDpi: 96, width: 1181, height: 1181 },
  ]) {
    const raw = makeMinimalJpeg(opts);
    const sosIndexBefore = raw.findIndex((_, i) => i < raw.length - 1 && raw[i] === 0xff && raw[i + 1] === 0xda);
    const tagged = setJpegDpi(raw, 300, 300);
    const meta = readJpegMetadata(tagged);

    assert.equal(meta.valid, true);
    assert.equal(meta.hasEoi, true);
    assert.equal(meta.jfif.found, true);
    assert.equal(meta.jfif.count, 1);
    assert.equal(meta.jfif.units, 1);
    assert.equal(meta.jfif.xDensity, 300);
    assert.equal(meta.jfif.yDensity, 300);
    assert.equal(meta.sof.width, opts.width);
    assert.equal(meta.sof.height, opts.height);

    if (opts.withExif) {
      assert.equal(meta.exif.found, true);
      assert.equal(meta.exif.xResolution, 300);
      assert.equal(meta.exif.yResolution, 300);
      assert.equal(meta.exif.resolutionUnit, 2);
    }

    // Verify entropy-coded SOS..EOF bytes are preserved identically
    const sosIndexAfter = tagged.findIndex((_, i) => i < tagged.length - 1 && tagged[i] === 0xff && tagged[i + 1] === 0xda);
    assert.deepEqual(tagged.subarray(sosIndexAfter), raw.subarray(sosIndexBefore));
  }
});

test('Validation #17: unique export filenames and STORE-mode ZIP round-trip CRC verification', () => {
  const used = new Set();
  assert.equal(buildExportFilename('Vacation Photo.JPG', 10, 15, used), 'Vacation_Photo_10x15cm_300dpi.jpg');
  assert.equal(buildExportFilename('Vacation Photo.JPG', 10, 15, used), 'Vacation_Photo_10x15cm_300dpi_2.jpg');
  assert.equal(buildExportFilename('vacation photo.png', 10, 15, used), 'vacation_photo_10x15cm_300dpi_3.jpg');

  const jpgA = setJpegDpi(makeMinimalJpeg({ width: 1181, height: 1772 }), 300, 300);
  const jpgB = setJpegDpi(makeMinimalJpeg({ width: 1535, height: 2126 }), 300, 300);
  const zipBytes = createStoreZip([
    { name: 'a_10x15cm_300dpi.jpg', data: jpgA },
    { name: 'a_10x15cm_300dpi_2.jpg', data: jpgB },
  ]);
  const parsed = parseZipEntries(zipBytes);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'a_10x15cm_300dpi.jpg');
  assert.deepEqual(parsed[0].data, jpgA);
  assert.equal(parsed[1].name, 'a_10x15cm_300dpi_2.jpg');
  assert.deepEqual(parsed[1].data, jpgB);
});
