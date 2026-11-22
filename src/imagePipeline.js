import {
  DPI,
  JPEG_QUALITY,
  DECODE_CONCURRENCY,
  DECODED_CACHE_LIMIT,
  MAX_SOURCE_SIDE_PX,
  MAX_SOURCE_PIXELS,
  MAX_SOURCE_FILE_BYTES,
  MAX_ZIP_ARCHIVE_BYTES,
  DOWNLOAD_REVOKE_DELAY_MS,
} from './constants.js';
import { clampCrop, computeImageDrawRect } from './geometry.js';
import { validateOutputDimensions, buildExportFilename } from './validation.js';
import { setJpegDpi, readJpegMetadata } from './jpegMetadata.js';
import { createStoreZip } from './zipWriter.js';

export async function decodeImageFile(file) {
  if (!file || typeof file.size !== 'number') {
    throw new Error('Invalid file object.');
  }
  if (file.size === 0) {
    throw new Error(`"${file.name || 'File'}" is empty (0 bytes).`);
  }
  if (file.size > MAX_SOURCE_FILE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    const limitMb = Math.round(MAX_SOURCE_FILE_BYTES / (1024 * 1024));
    throw new Error(`"${file.name}" is ${mb} MB, exceeding the ${limitMb} MB per-file limit.`);
  }

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (ok, err) => {
        if (settled) return;
        settled = true;
        img.onload = null;
        img.onerror = null;
        if (ok) resolve();
        else reject(err || new Error(`Unable to decode "${file.name}".`));
      };

      img.onload = async () => {
        try {
          if (typeof img.decode === 'function') {
            await img.decode();
          }
          done(true);
        } catch (err) {
          done(false, new Error(`"${file.name}" could not be decoded (${err?.message || 'corrupt image'}).`));
        }
      };

      img.onerror = () => {
        done(false, new Error(`"${file.name}" is corrupt or not a browser-supported image format.`));
      };

      img.src = url;
    });

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      throw new Error(`"${file.name}" decoded with empty dimensions.`);
    }
    if (w > MAX_SOURCE_SIDE_PX || h > MAX_SOURCE_SIDE_PX || w * h > MAX_SOURCE_PIXELS) {
      throw new Error(
        `"${file.name}" (${w} × ${h} px) exceeds the safe source decode limit (${MAX_SOURCE_SIDE_PX.toLocaleString()} px/side, ${(MAX_SOURCE_PIXELS / 1e6).toFixed(0)} MP).`
      );
    }

    return {
      img,
      url,
      naturalWidth: w,
      naturalHeight: h,
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export function createAssetManager({
  cacheLimit = DECODED_CACHE_LIMIT,
  decodeConcurrency = DECODE_CONCURRENCY,
} = {}) {
  const cache = new Map();
  const leases = new Map();
  const inFlight = new Map();
  const disposed = new Set();
  const queue = [];
  let activeDecodes = 0;

  function revokeEntry(id) {
    const entry = cache.get(id);
    if (entry) {
      URL.revokeObjectURL(entry.url);
      cache.delete(id);
    }
  }

  function evictIfNeeded() {
    if (cache.size <= cacheLimit) return;
    for (const key of cache.keys()) {
      if (cache.size <= cacheLimit) break;
      if ((leases.get(key) || 0) === 0) {
        revokeEntry(key);
      }
    }
  }

  function touchLru(id, entry) {
    cache.delete(id);
    cache.set(id, entry);
  }

  function pumpQueue() {
    while (activeDecodes < decodeConcurrency && queue.length > 0) {
      const task = queue.shift();
      if (disposed.has(task.id)) {
        task.reject(new Error('Image was removed before decoding.'));
        continue;
      }

      activeDecodes += 1;
      decodeImageFile(task.file)
        .then((entry) => {
          if (disposed.has(task.id)) {
            URL.revokeObjectURL(entry.url);
            throw new Error('Image was removed while decoding.');
          }
          touchLru(task.id, entry);
          evictIfNeeded();
          task.resolve(entry);
        })
        .catch((err) => {
          task.reject(err);
        })
        .finally(() => {
          activeDecodes -= 1;
          inFlight.delete(task.id);
          pumpQueue();
        });
    }
  }

  function enqueueDecode(id, file) {
    if (disposed.has(id)) {
      return Promise.reject(new Error('Image has been removed.'));
    }
    if (cache.has(id)) {
      const cached = cache.get(id);
      touchLru(id, cached);
      return Promise.resolve(cached);
    }
    if (inFlight.has(id)) {
      return inFlight.get(id);
    }

    const promise = new Promise((resolve, reject) => {
      queue.push({ id, file, resolve, reject });
      pumpQueue();
    });
    inFlight.set(id, promise);
    return promise;
  }

  function releaseLease(id) {
    const count = leases.get(id) || 0;
    if (count <= 1) {
      leases.delete(id);
      if (disposed.has(id)) {
        revokeEntry(id);
      } else {
        evictIfNeeded();
      }
    } else {
      leases.set(id, count - 1);
    }
  }

  async function acquireDecoded(id, file) {
    if (disposed.has(id)) {
      throw new Error('Image has been removed.');
    }
    leases.set(id, (leases.get(id) || 0) + 1);
    try {
      const entry = await enqueueDecode(id, file);
      if (disposed.has(id)) {
        throw new Error('Image was removed.');
      }
      touchLru(id, entry);
      return {
        img: entry.img,
        naturalWidth: entry.naturalWidth,
        naturalHeight: entry.naturalHeight,
        release: () => releaseLease(id),
      };
    } catch (err) {
      releaseLease(id);
      throw err;
    }
  }

  function dispose(id) {
    disposed.add(id);
    if ((leases.get(id) || 0) === 0) {
      revokeEntry(id);
    }
  }

  function disposeAll() {
    for (const key of Array.from(cache.keys())) {
      disposed.add(key);
      if ((leases.get(key) || 0) === 0) {
        revokeEntry(key);
      }
    }
    for (const task of queue.splice(0)) {
      disposed.add(task.id);
      task.reject(new Error('Batch cleared.'));
    }
  }

  function getStats() {
    return {
      cacheSize: cache.size,
      activeLeases: Array.from(leases.values()).reduce((a, b) => a + b, 0),
      queueLength: queue.length,
      inFlightCount: inFlight.size,
    };
  }

  return {
    enqueueDecode,
    acquireDecoded,
    dispose,
    disposeAll,
    getStats,
  };
}

/**
 * Shared preview canvas renderer.
 * Draws the stage backdrop, white print paper area inside maskRect, the transformed source image,
 * and a 4-rectangle outer scrim (avoids ultrawide CSS box-shadow clipping).
 */
export function renderPreviewCanvas(canvas, layout, img, crop, dpr = 1) {
  if (!canvas || !layout || !img) return false;
  const { stageW, stageH, maskRect } = layout;
  if (stageW <= 0 || stageH <= 0 || maskRect.width <= 0 || maskRect.height <= 0) {
    return false;
  }

  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 4) : 1;
  const backingW = Math.max(1, Math.round(stageW * safeDpr));
  const backingH = Math.max(1, Math.round(stageH * safeDpr));

  if (canvas.width !== backingW || canvas.height !== backingH) {
    canvas.width = backingW;
    canvas.height = backingH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  ctx.setTransform(safeDpr, 0, 0, safeDpr, 0, 0);
  ctx.clearRect(0, 0, stageW, stageH);

  // Outer stage surface
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(0, 0, stageW, stageH);

  // White paper background inside mask (matches JPEG white compositing)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(maskRect.x, maskRect.y, maskRect.width, maskRect.height);

  const drawRect = computeImageDrawRect(img.naturalWidth, img.naturalHeight, maskRect, crop);
  if (drawRect) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
  }

  // Translucent scrim outside maskRect (4 non-overlapping rects)
  ctx.fillStyle = 'rgba(241, 245, 249, 0.72)';
  const rightEdge = maskRect.x + maskRect.width;
  const bottomEdge = maskRect.y + maskRect.height;

  if (maskRect.y > 0) {
    ctx.fillRect(0, 0, stageW, maskRect.y);
  }
  if (bottomEdge < stageH) {
    ctx.fillRect(0, bottomEdge, stageW, stageH - bottomEdge);
  }
  if (maskRect.x > 0) {
    ctx.fillRect(0, maskRect.y, maskRect.x, maskRect.height);
  }
  if (rightEdge < stageW) {
    ctx.fillRect(rightEdge, maskRect.y, stageW - rightEdge, maskRect.height);
  }

  return true;
}

/**
 * Exports a single immutable click-time snapshot to a 300-DPI JPEG Blob with JFIF density metadata.
 */
export async function exportCropToJpegBlob(snapshot, assetManager) {
  const dpi = snapshot.dpi ?? DPI;
  const dimCheck = validateOutputDimensions(snapshot.widthCm, snapshot.heightCm, dpi);
  if (!dimCheck.valid) {
    throw new Error(dimCheck.error);
  }

  const { widthPx, heightPx } = dimCheck;
  const lease = await assetManager.acquireDecoded(snapshot.id, snapshot.file);
  const exportCanvas = document.createElement('canvas');

  try {
    exportCanvas.width = widthPx;
    exportCanvas.height = heightPx;

    const ctx = exportCanvas.getContext('2d');
    if (!ctx) {
      throw new Error(
        `Unable to initialize ${widthPx} × ${heightPx} px export canvas context. Try reducing dimensions.`
      );
    }

    const targetAspect = widthPx / heightPx;
    const clampedCrop = clampCrop(
      snapshot.crop,
      lease.naturalWidth,
      lease.naturalHeight,
      targetAspect,
      snapshot.fitMode
    );
    const drawRect = computeImageDrawRect(
      lease.naturalWidth,
      lease.naturalHeight,
      { x: 0, y: 0, width: widthPx, height: heightPx },
      clampedCrop
    );
    if (!drawRect) {
      throw new Error('Could not compute export framing geometry.');
    }

    // White background compositing (required for transparent PNG/WebP or White Borders mode)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthPx, heightPx);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(lease.img, drawRect.x, drawRect.y, drawRect.width, drawRect.height);

    const rawBlob = await new Promise((resolve, reject) => {
      try {
        exportCanvas.toBlob(
          (blob) => {
            if (!blob || blob.size === 0) {
              reject(
                new Error(
                  `JPEG encoding failed for ${widthPx} × ${heightPx} px output. Try reducing dimensions or freeing memory.`
                )
              );
              return;
            }
            resolve(blob);
          },
          'image/jpeg',
          JPEG_QUALITY
        );
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Canvas JPEG encoding threw an error.'));
      }
    });

    const rawBytes = new Uint8Array(await rawBlob.arrayBuffer());
    const taggedBytes = setJpegDpi(rawBytes, dpi, dpi);
    const metadata = readJpegMetadata(taggedBytes);

    if (!metadata.valid || !metadata.sof.found) {
      throw new Error('Generated JPEG failed structural verification.');
    }

    return {
      blob: new Blob([taggedBytes], { type: 'image/jpeg' }),
      bytes: taggedBytes,
      widthPx,
      heightPx,
      metadata,
    };
  } finally {
    exportCanvas.width = 0;
    exportCanvas.height = 0;
    lease.release();
  }
}

export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, DOWNLOAD_REVOKE_DELAY_MS);
}

/**
 * Sequentially exports a snapshot list into a single STORE-mode ZIP archive,
 * bounding retained archive memory and supporting cancellation between items.
 */
export async function exportBatchToZip(snapshots, assetManager, { signal, onProgress } = {}) {
  const entries = [];
  const failures = [];
  const skipped = [];
  const usedNames = new Set();
  let totalBytes = 0;
  let cancelled = false;

  for (let i = 0; i < snapshots.length; i += 1) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }

    const snap = snapshots[i];
    onProgress?.({ completed: i, total: snapshots.length, currentName: snap.name, totalBytes });

    try {
      const result = await exportCropToJpegBlob(snap, assetManager);
      if (signal?.aborted) {
        cancelled = true;
        break;
      }

      if (totalBytes + result.bytes.length > MAX_ZIP_ARCHIVE_BYTES) {
        skipped.push({
          name: snap.name,
          reason: `Reached ${Math.round(MAX_ZIP_ARCHIVE_BYTES / (1024 * 1024))} MB ZIP memory limit.`,
        });
        continue;
      }

      const filename = buildExportFilename(
        snap.name,
        snap.widthCm,
        snap.heightCm,
        usedNames,
        snap.dpi ?? DPI
      );
      entries.push({ name: filename, data: result.bytes });
      totalBytes += result.bytes.length;
    } catch (err) {
      failures.push({
        name: snap.name,
        error: err instanceof Error ? err.message : 'Export failed.',
      });
    }
  }

  onProgress?.({
    completed: snapshots.length,
    total: snapshots.length,
    currentName: '',
    totalBytes,
  });

  if (cancelled || entries.length === 0) {
    return { entries, failures, skipped, cancelled, totalBytes, zipBlob: null };
  }

  const zipBytes = createStoreZip(entries);
  const zipBlob = new Blob([zipBytes], { type: 'application/zip' });
  return { entries, failures, skipped, cancelled: false, totalBytes, zipBlob };
}
