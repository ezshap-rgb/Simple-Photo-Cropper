import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DPI,
  PRESETS,
  FIT_MODES,
  MIN_ZOOM_FILL,
  MIN_ZOOM_BORDERS,
  MAX_ZOOM,
  MAX_BATCH_FILES,
  MAX_ZIP_ARCHIVE_BYTES,
} from './constants.js';
import {
  DEFAULT_CROP,
  adaptCropForAspectChange,
  applyPanDelta,
  clampCrop,
  computeEffectiveSourcePpi,
  computeStageLayout,
  resolveEffectiveDimensions,
} from './geometry.js';
import {
  buildExportFilename,
  formatCm,
  parseCustomCm,
  validateOutputDimensions,
} from './validation.js';
import {
  createAssetManager,
  exportBatchToZip,
  exportCropToJpegBlob,
  renderPreviewCanvas,
  triggerBlobDownload,
} from './imagePipeline.js';

const COMPACT_MEDIA_QUERY = '(max-width: 767px), (max-width: 1024px) and (orientation: portrait)';

function useIsCompactLayout() {
  const [isCompact, setIsCompact] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(COMPACT_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(COMPACT_MEDIA_QUERY);
    const update = () => setIsCompact(mq.matches);
    update();

    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    }
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);

  return isCompact;
}

function CollapsibleSection({ id, title, summary, summaryTone, open, onToggle, children }) {
  const panelId = `collapse-panel-${id}`;
  const triggerId = `collapse-trigger-${id}`;
  return (
    <div className="collapsible-card">
      <button
        id={triggerId}
        type="button"
        className="collapsible-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid={`collapse-toggle-${id}`}
        onClick={onToggle}
      >
        <span className="collapsible-title-wrap">
          <span className="collapsible-chevron" aria-hidden="true">▸</span>
          <span>{title}</span>
        </span>
        {summary && (
          <span
            className={`collapsible-summary ${summaryTone === 'warn' ? 'is-warn' : ''} ${summaryTone === 'error' ? 'is-error' : ''}`}
          >
            {summary}
          </span>
        )}
      </button>
      {open && (
        <div id={panelId} role="region" aria-labelledby={triggerId} className="collapsible-body">
          {children}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const isCompact = useIsCompactLayout();

  const [images, setImages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [preset, setPreset] = useState('10x15');
  const [orientation, setOrientation] = useState('portrait');
  const [customWText, setCustomWText] = useState('10');
  const [customHText, setCustomHText] = useState('10');

  const [mobileTab, setMobileTab] = useState('photos');
  const [mobileSections, setMobileSections] = useState({
    batchList: true,
    batchZip: false,
    sizePreset: true,
    sizeSpecs: false,
    cropZoom: true,
    cropMode: false,
    cropPpi: false,
  });

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [batchProgress, setBatchProgress] = useState({
    active: false,
    completed: 0,
    total: 0,
    currentName: '',
  });
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const fileInputRef = useRef(null);
  const assetManagerRef = useRef(null);
  if (!assetManagerRef.current) {
    assetManagerRef.current = createAssetManager();
  }

  const idSeqRef = useRef(0);
  const renderGenRef = useRef(0);
  const rafRef = useRef(0);
  const activePointerRef = useRef(null);
  const batchAbortRef = useRef(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const customWidthParse = useMemo(
    () => (preset === 'custom' ? parseCustomCm(customWText, 'Width') : null),
    [preset, customWText]
  );
  const customHeightParse = useMemo(
    () => (preset === 'custom' ? parseCustomCm(customHText, 'Height') : null),
    [preset, customHText]
  );

  const outputSpec = useMemo(() => {
    if (preset !== 'custom') {
      const dims = resolveEffectiveDimensions({ preset, orientation });
      const check = validateOutputDimensions(dims.widthCm, dims.heightCm, DPI);
      return {
        ...check,
        widthCm: dims.widthCm,
        heightCm: dims.heightCm,
      };
    }

    if (!customWidthParse?.valid || !customHeightParse?.valid) {
      return {
        valid: false,
        error: customWidthParse?.error || customHeightParse?.error || 'Enter valid custom dimensions.',
        widthCm: null,
        heightCm: null,
        widthPx: 0,
        heightPx: 0,
        totalPixels: 0,
        estimatedMb: 0,
      };
    }

    const widthCm = customWidthParse.value;
    const heightCm = customHeightParse.value;
    const check = validateOutputDimensions(widthCm, heightCm, DPI);
    return {
      ...check,
      widthCm,
      heightCm,
    };
  }, [preset, orientation, customWidthParse, customHeightParse]);

  const lastValidDimsRef = useRef({ widthCm: 10, heightCm: 15, widthPx: 1181, heightPx: 1772 });
  if (outputSpec.valid) {
    lastValidDimsRef.current = {
      widthCm: outputSpec.widthCm,
      heightCm: outputSpec.heightCm,
      widthPx: outputSpec.widthPx,
      heightPx: outputSpec.heightPx,
    };
  }

  const previewDims = outputSpec.valid ? outputSpec : lastValidDimsRef.current;
  const targetAspect = previewDims.widthPx / previewDims.heightPx;

  const selectedItem = useMemo(
    () => images.find((item) => item.id === selectedId) || null,
    [images, selectedId]
  );

  const readyItems = useMemo(
    () => images.filter((item) => item.status === 'ready'),
    [images]
  );

  const prevReadyCountRef = useRef(0);
  useEffect(() => {
    const prevReady = prevReadyCountRef.current;
    prevReadyCountRef.current = readyItems.length;
    if (isCompact && prevReady === 0 && readyItems.length > 0 && mobileTab === 'photos') {
      setMobileTab('crop');
    }
  }, [isCompact, readyItems.length, mobileTab]);

  const stageLayout = useMemo(
    () => computeStageLayout(stageSize.width, stageSize.height, targetAspect),
    [stageSize.width, stageSize.height, targetAspect]
  );

  const effectivePpiInfo = useMemo(() => {
    if (!selectedItem || selectedItem.status !== 'ready') return null;
    return computeEffectiveSourcePpi(
      selectedItem.naturalWidth,
      selectedItem.naturalHeight,
      previewDims.widthCm,
      previewDims.heightCm,
      selectedItem.crop,
      DPI
    );
  }, [selectedItem, previewDims.widthCm, previewDims.heightCm]);

  const toggleSection = useCallback((key) => {
    setMobileSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Re-clamp all ready items cleanly whenever target aspect ratio changes
  useEffect(() => {
    setImages((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (item.status !== 'ready') return item;
        const clamped = adaptCropForAspectChange(
          item.crop,
          item.naturalWidth,
          item.naturalHeight,
          targetAspect,
          item.fitMode
        );
        if (
          clamped.centerX === item.crop.centerX &&
          clamped.centerY === item.crop.centerY &&
          clamped.zoom === item.crop.zoom
        ) {
          return item;
        }
        changed = true;
        return { ...item, crop: clamped };
      });
      return changed ? next : prev;
    });
  }, [targetAspect]);

  // Observe authoritative stage container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const nextW = Math.floor(rect.width);
      const nextH = Math.floor(rect.height);
      setStageSize((prev) =>
        prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH }
      );
    };

    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isCompact]);

  // Cleanup all decoded resources on unmount
  useEffect(() => {
    const manager = assetManagerRef.current;
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (batchAbortRef.current) batchAbortRef.current.abort();
      manager.disposeAll();
    };
  }, []);

  // Safe async preview draw with generation tokens and rAF coalescing
  useEffect(() => {
    const gen = ++renderGenRef.current;
    let active = true;

    if (!selectedItem || selectedItem.status !== 'ready' || !stageLayout || !canvasRef.current) {
      const canvas = canvasRef.current;
      if (canvas && stageSize.width > 0 && stageSize.height > 0) {
        const dpr = Math.min(window.devicePixelRatio || 1, 4);
        const bw = Math.max(1, Math.round(stageSize.width * dpr));
        const bh = Math.max(1, Math.round(stageSize.height * dpr));
        if (canvas.width !== bw || canvas.height !== bh) {
          canvas.width = bw;
          canvas.height = bh;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, stageSize.width, stageSize.height);
        }
      }
      return () => {
        active = false;
      };
    }

    const cropSnapshot = selectedItem.crop;
    const itemId = selectedItem.id;
    const itemFile = selectedItem.file;

    assetManagerRef.current
      .acquireDecoded(itemId, itemFile)
      .then((lease) => {
        if (!active || gen !== renderGenRef.current) {
          lease.release();
          return;
        }

        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
        }

        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          try {
            if (!active || gen !== renderGenRef.current || !canvasRef.current) return;
            const dpr = window.devicePixelRatio || 1;
            renderPreviewCanvas(canvasRef.current, stageLayout, lease.img, cropSnapshot, dpr);
          } finally {
            lease.release();
          }
        });
      })
      .catch((err) => {
        if (!active || gen !== renderGenRef.current) return;
        const msg = err instanceof Error ? err.message : 'Unable to preview image.';
        setImages((prev) =>
          prev.map((item) =>
            item.id === itemId && item.status === 'ready'
              ? { ...item, status: 'error', error: msg }
              : item
          )
        );
      });

    return () => {
      active = false;
    };
  }, [selectedItem, stageLayout, stageSize.width, stageSize.height]);

  const updateReadyItem = useCallback((id, updater) => {
    setImages((prev) =>
      prev.map((item) => {
        if (item.id !== id || item.status !== 'ready') return item;
        return updater(item);
      })
    );
  }, []);

  const handleFileUpload = useCallback(
    (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length === 0) return;

      setErrorMessage('');
      const availableSlots = Math.max(0, MAX_BATCH_FILES - imagesRef.current.length);
      if (availableSlots === 0) {
        setErrorMessage(`Batch limit reached (${MAX_BATCH_FILES} images). Remove items before adding more.`);
        return;
      }

      const acceptedFiles = files.slice(0, availableSlots);
      const truncated = files.length > availableSlots;

      const newItems = acceptedFiles.map((file) => {
        idSeqRef.current += 1;
        return {
          id: `img_${idSeqRef.current}`,
          file,
          name: file.name || `photo_${idSeqRef.current}`,
          status: 'loading',
          error: null,
          naturalWidth: 0,
          naturalHeight: 0,
          crop: { ...DEFAULT_CROP },
          fitMode: FIT_MODES.FILL,
        };
      });

      setImages((prev) => [...prev, ...newItems]);
      setSelectedId((prevSelected) => prevSelected ?? newItems[0].id);
      setStatusMessage(
        truncated
          ? `Added ${acceptedFiles.length} of ${files.length} files (max ${MAX_BATCH_FILES} per batch). Decoding…`
          : `Added ${acceptedFiles.length} image${acceptedFiles.length === 1 ? '' : 's'}. Decoding…`
      );

      for (const item of newItems) {
        assetManagerRef.current
          .enqueueDecode(item.id, item.file)
          .then((decoded) => {
            const exists = imagesRef.current.some((entry) => entry.id === item.id);
            if (!exists) return;

            setImages((prev) =>
              prev.map((entry) => {
                if (entry.id !== item.id) return entry;
                const nextCrop = clampCrop(
                  DEFAULT_CROP,
                  decoded.naturalWidth,
                  decoded.naturalHeight,
                  targetAspect,
                  entry.fitMode
                );
                return {
                  ...entry,
                  status: 'ready',
                  error: null,
                  naturalWidth: decoded.naturalWidth,
                  naturalHeight: decoded.naturalHeight,
                  crop: nextCrop,
                };
              })
            );
            setStatusMessage((prevMsg) =>
              prevMsg.includes('Decoding…') ? `Ready to crop "${item.name}".` : prevMsg
            );
          })
          .catch((err) => {
            const exists = imagesRef.current.some((entry) => entry.id === item.id);
            if (!exists) return;

            const msg = err instanceof Error ? err.message : 'Unable to decode image.';
            setImages((prev) =>
              prev.map((entry) =>
                entry.id === item.id
                  ? { ...entry, status: 'error', error: msg }
                  : entry
              )
            );
          });
      }
    },
    [targetAspect]
  );

  const removeImage = useCallback((idToRemove) => {
    if (activePointerRef.current?.itemId === idToRemove) {
      activePointerRef.current = null;
      setIsDragging(false);
    }

    const currentList = imagesRef.current;
    const idx = currentList.findIndex((item) => item.id === idToRemove);
    if (idx < 0) return;

    const remaining = currentList.filter((item) => item.id !== idToRemove);
    setImages(remaining);
    setSelectedId((prevSel) => {
      if (prevSel !== idToRemove) return prevSel;
      if (remaining.length === 0) return null;
      return remaining[Math.min(idx, remaining.length - 1)].id;
    });

    assetManagerRef.current.dispose(idToRemove);
    setStatusMessage(`Removed "${currentList[idx].name}".`);
  }, []);

  const clearBatch = useCallback(() => {
    if (batchAbortRef.current) {
      batchAbortRef.current.abort();
    }
    activePointerRef.current = null;
    setIsDragging(false);
    setImages([]);
    setSelectedId(null);
    setErrorMessage('');
    assetManagerRef.current.disposeAll();
    setStatusMessage('Cleared all images from batch.');
  }, []);

  const setFitMode = useCallback(
    (nextMode) => {
      if (!selectedItem || selectedItem.status !== 'ready') return;
      updateReadyItem(selectedItem.id, (item) => ({
        ...item,
        fitMode: nextMode,
        crop: clampCrop(item.crop, item.naturalWidth, item.naturalHeight, targetAspect, nextMode),
      }));
    },
    [selectedItem, targetAspect, updateReadyItem]
  );

  const setZoom = useCallback(
    (nextZoom) => {
      if (!selectedItem || selectedItem.status !== 'ready') return;
      updateReadyItem(selectedItem.id, (item) => ({
        ...item,
        crop: clampCrop(
          { ...item.crop, zoom: nextZoom },
          item.naturalWidth,
          item.naturalHeight,
          targetAspect,
          item.fitMode
        ),
      }));
    },
    [selectedItem, targetAspect, updateReadyItem]
  );

  const resetFraming = useCallback(() => {
    if (!selectedItem || selectedItem.status !== 'ready') return;
    updateReadyItem(selectedItem.id, (item) => ({
      ...item,
      crop: clampCrop(
        DEFAULT_CROP,
        item.naturalWidth,
        item.naturalHeight,
        targetAspect,
        item.fitMode
      ),
    }));
    setStatusMessage('Reset framing to centered fit.');
  }, [selectedItem, targetAspect, updateReadyItem]);

  const swapCustomDimensions = useCallback(() => {
    setCustomWText(customHText);
    setCustomHText(customWText);
  }, [customWText, customHText]);

  const endPointerGesture = useCallback((e) => {
    const active = activePointerRef.current;
    if (!active) return;
    if (e && e.pointerId !== active.pointerId) return;

    activePointerRef.current = null;
    setIsDragging(false);

    if (e?.currentTarget && typeof e.currentTarget.hasPointerCapture === 'function') {
      try {
        if (e.currentTarget.hasPointerCapture(active.pointerId)) {
          e.currentTarget.releasePointerCapture(active.pointerId);
        }
      } catch {
        // Ignore if capture already released
      }
    }
  }, []);

  useEffect(() => {
    const onBlur = () => endPointerGesture(null);
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [endPointerGesture]);

  const handlePointerDown = useCallback(
    (e) => {
      if (!e.isPrimary) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (activePointerRef.current !== null) return;
      if (!selectedItem || selectedItem.status !== 'ready' || !stageLayout) return;

      e.preventDefault();
      e.currentTarget.focus({ preventScroll: true });

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events or unsupported environments may skip capture
      }

      activePointerRef.current = {
        pointerId: e.pointerId,
        itemId: selectedItem.id,
        lastX: e.clientX,
        lastY: e.clientY,
      };
      setIsDragging(true);
    },
    [selectedItem, stageLayout]
  );

  const handlePointerMove = useCallback(
    (e) => {
      const active = activePointerRef.current;
      if (!active || e.pointerId !== active.pointerId || !stageLayout) return;

      const dx = e.clientX - active.lastX;
      const dy = e.clientY - active.lastY;
      if (dx === 0 && dy === 0) return;

      active.lastX = e.clientX;
      active.lastY = e.clientY;

      updateReadyItem(active.itemId, (item) => ({
        ...item,
        crop: applyPanDelta(
          item.crop,
          dx,
          dy,
          item.naturalWidth,
          item.naturalHeight,
          stageLayout.maskRect,
          item.fitMode
        ),
      }));
    },
    [stageLayout, updateReadyItem]
  );

  const handleStageKeyDown = useCallback(
    (e) => {
      if (!selectedItem || selectedItem.status !== 'ready' || !stageLayout) return;

      const step = e.shiftKey ? 32 : 8;
      let dx = 0;
      let dy = 0;

      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom(selectedItem.crop.zoom + 0.1);
        return;
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom(selectedItem.crop.zoom - 0.1);
        return;
      } else if (e.key === '0') {
        e.preventDefault();
        resetFraming();
        return;
      } else {
        return;
      }

      e.preventDefault();
      updateReadyItem(selectedItem.id, (item) => ({
        ...item,
        crop: applyPanDelta(
          item.crop,
          dx,
          dy,
          item.naturalWidth,
          item.naturalHeight,
          stageLayout.maskRect,
          item.fitMode
        ),
      }));
    },
    [selectedItem, stageLayout, setZoom, resetFraming, updateReadyItem]
  );

  const handleDownloadSingle = useCallback(async () => {
    if (!outputSpec.valid || !selectedItem || selectedItem.status !== 'ready') return;
    if (isExporting || batchProgress.active) return;

    const snapshot = {
      id: selectedItem.id,
      name: selectedItem.name,
      file: selectedItem.file,
      crop: { ...selectedItem.crop },
      fitMode: selectedItem.fitMode,
      widthCm: outputSpec.widthCm,
      heightCm: outputSpec.heightCm,
      dpi: DPI,
    };

    setIsExporting(true);
    setErrorMessage('');
    setStatusMessage(`Preparing ${snapshot.name} (${outputSpec.widthPx} × ${outputSpec.heightPx} px)…`);

    try {
      const result = await exportCropToJpegBlob(snapshot, assetManagerRef.current);
      const filename = buildExportFilename(
        snapshot.name,
        snapshot.widthCm,
        snapshot.heightCm,
        null,
        snapshot.dpi
      );
      triggerBlobDownload(result.blob, filename);
      setStatusMessage(
        `Generated ${filename} (${result.widthPx} × ${result.heightPx} px, ${DPI} PPI metadata). Browser download triggered.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Export failed.');
      setStatusMessage('');
    } finally {
      setIsExporting(false);
    }
  }, [outputSpec, selectedItem, isExporting, batchProgress.active]);

  const handleDownloadAllZip = useCallback(async () => {
    if (!outputSpec.valid || readyItems.length === 0) return;
    if (isExporting || batchProgress.active) return;

    const snapshots = readyItems.map((item) => ({
      id: item.id,
      name: item.name,
      file: item.file,
      crop: { ...item.crop },
      fitMode: item.fitMode,
      widthCm: outputSpec.widthCm,
      heightCm: outputSpec.heightCm,
      dpi: DPI,
    }));

    const controller = new AbortController();
    batchAbortRef.current = controller;

    setErrorMessage('');
    setBatchProgress({
      active: true,
      completed: 0,
      total: snapshots.length,
      currentName: snapshots[0].name,
    });
    setStatusMessage(`Preparing ZIP archive for ${snapshots.length} photos…`);

    try {
      const result = await exportBatchToZip(snapshots, assetManagerRef.current, {
        signal: controller.signal,
        onProgress: (p) => {
          setBatchProgress({
            active: true,
            completed: p.completed,
            total: p.total,
            currentName: p.currentName,
          });
        },
      });

      if (result.cancelled) {
        setStatusMessage(`Batch export cancelled after ${result.entries.length} of ${snapshots.length} photos.`);
        return;
      }

      if (result.zipBlob) {
        const zipName = `photos_${formatCm(outputSpec.widthCm)}x${formatCm(outputSpec.heightCm)}cm_${DPI}dpi.zip`;
        triggerBlobDownload(result.zipBlob, zipName);
        const mb = (result.zipBlob.size / (1024 * 1024)).toFixed(2);
        const parts = [`Generated ${zipName} with ${result.entries.length} photo(s) (${mb} MB).`];
        if (result.failures.length > 0) {
          parts.push(`${result.failures.length} failed.`);
        }
        if (result.skipped.length > 0) {
          parts.push(`${result.skipped.length} skipped (${Math.round(MAX_ZIP_ARCHIVE_BYTES / (1024 * 1024))} MB ZIP budget).`);
        }
        setStatusMessage(parts.join(' '));
      }

      if (result.failures.length > 0 || result.skipped.length > 0) {
        const details = [
          ...result.failures.map((f) => `${f.name}: ${f.error}`),
          ...result.skipped.map((s) => `${s.name}: ${s.reason}`),
        ].join(' | ');
        setErrorMessage(details);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Batch ZIP export failed.');
    } finally {
      batchAbortRef.current = null;
      setBatchProgress({ active: false, completed: 0, total: 0, currentName: '' });
    }
  }, [outputSpec, readyItems, isExporting, batchProgress.active]);

  const cancelBatchExport = useCallback(() => {
    if (batchAbortRef.current) {
      batchAbortRef.current.abort();
    }
  }, []);

  const zoomMin = selectedItem?.fitMode === FIT_MODES.BORDERS ? MIN_ZOOM_BORDERS : MIN_ZOOM_FILL;
  const canExportSingle =
    outputSpec.valid &&
    selectedItem?.status === 'ready' &&
    !isExporting &&
    !batchProgress.active;
  const canExportBatch =
    outputSpec.valid &&
    readyItems.length > 0 &&
    !isExporting &&
    !batchProgress.active;

  // Reusable control fragments shared across desktop sidebar and mobile tabs
  const renderSizeControls = () => (
    <>
      <div>
        <label htmlFor="preset-select" className="field-label">
          Print format
        </label>
        <select
          id="preset-select"
          className="select-input"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
        >
          <option value="10x15">{PRESETS['10x15'].label}</option>
          <option value="13x18">{PRESETS['13x18'].label}</option>
          <option value="custom">Custom Size (cm)</option>
        </select>
      </div>

      {preset !== 'custom' ? (
        <div className="segmented-group" role="group" aria-label="Preset orientation">
          <button
            type="button"
            className="segmented-btn"
            aria-pressed={orientation === 'portrait'}
            onClick={() => setOrientation('portrait')}
          >
            Portrait
          </button>
          <button
            type="button"
            className="segmented-btn"
            aria-pressed={orientation === 'landscape'}
            onClick={() => setOrientation('landscape')}
          >
            Landscape
          </button>
        </div>
      ) : (
        <div className="custom-dims-row">
          <div>
            <label htmlFor="custom-width-input" className="field-label">
              Width (cm)
            </label>
            <input
              id="custom-width-input"
              type="text"
              inputMode="decimal"
              className={`text-input ${customWidthParse && !customWidthParse.valid ? 'is-invalid' : ''}`}
              value={customWText}
              onChange={(e) => setCustomWText(e.target.value)}
              aria-invalid={customWidthParse ? !customWidthParse.valid : false}
            />
          </div>
          <div>
            <label htmlFor="custom-height-input" className="field-label">
              Height (cm)
            </label>
            <input
              id="custom-height-input"
              type="text"
              inputMode="decimal"
              className={`text-input ${customHeightParse && !customHeightParse.valid ? 'is-invalid' : ''}`}
              value={customHText}
              onChange={(e) => setCustomHText(e.target.value)}
              aria-invalid={customHeightParse ? !customHeightParse.valid : false}
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary custom-swap-btn"
            onClick={swapCustomDimensions}
            title="Swap width and height"
            aria-label="Swap custom width and height"
          >
            Swap
          </button>
        </div>
      )}

      {!outputSpec.valid && (
        <div className="alert-box alert-error" role="alert">
          {outputSpec.error}
        </div>
      )}
    </>
  );

  const renderOutputSpecPill = () =>
    outputSpec.valid ? (
      <div className="meta-pill" data-testid="output-spec">
        Output: <strong>{formatCm(outputSpec.widthCm)} × {formatCm(outputSpec.heightCm)} cm</strong>
        {' • '}
        <strong>{outputSpec.widthPx} × {outputSpec.heightPx} px</strong>
        {' @ '}
        {DPI} PPI JPEG
      </div>
    ) : (
      <div className="alert-box alert-error" role="alert">
        {outputSpec.error}
      </div>
    );

  const renderBatchList = () =>
    images.length === 0 ? (
      <p className="empty-batch">No images loaded yet.</p>
    ) : (
      <ul className="batch-list" aria-label="Uploaded photos">
        {images.map((item, idx) => {
          const isActive = item.id === selectedId;
          return (
            <li
              key={item.id}
              className={`batch-item-row ${isActive ? 'is-active' : ''} ${item.status === 'error' ? 'is-error' : ''}`}
            >
              <button
                type="button"
                className="batch-select-btn"
                aria-current={isActive ? 'true' : undefined}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="batch-item-name">
                  {idx + 1}. {item.name}
                </span>
                {item.status === 'loading' && (
                  <span className="batch-badge">Loading</span>
                )}
                {item.status === 'error' && (
                  <span className="batch-badge is-error">Error</span>
                )}
              </button>
              <button
                type="button"
                className="batch-remove-btn"
                aria-label={`Remove ${item.name}`}
                onClick={() => removeImage(item.id)}
                title={`Remove ${item.name}`}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    );

  const renderBatchZipControls = () => (
    <>
      {!batchProgress.active ? (
        <button
          type="button"
          className="btn btn-zip btn-full"
          onClick={handleDownloadAllZip}
          disabled={!canExportBatch}
        >
          Download All Ready ({readyItems.length}) as ZIP
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="meta-pill">
            Exporting {batchProgress.completed + 1} of {batchProgress.total}:{' '}
            <strong>{batchProgress.currentName}</strong>
          </div>
          <div className="progress-track" aria-hidden="true">
            <div
              className="progress-fill"
              style={{
                width: `${batchProgress.total > 0 ? Math.round((batchProgress.completed / batchProgress.total) * 100) : 0}%`,
              }}
            />
          </div>
          <button type="button" className="btn btn-secondary btn-full" onClick={cancelBatchExport}>
            Cancel Batch Export
          </button>
        </div>
      )}
      <p className="help-note">
        Exports embed {DPI} PPI raster metadata; always verify matching paper size and borderless/fit options in your print dialog or lab.
      </p>
    </>
  );

  const renderZoomControls = () => (
    <>
      <div className="zoom-header-row">
        <label htmlFor="zoom-slider" className="field-label" style={{ marginBottom: 0 }}>
          Crop Zoom
        </label>
        <span className="zoom-value" data-testid="zoom-readout">
          {Math.round(selectedItem.crop.zoom * 100)}%
        </span>
      </div>
      <div className="zoom-slider-row">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          aria-label="Zoom out"
          onClick={() => setZoom(selectedItem.crop.zoom - 0.1)}
          disabled={selectedItem.crop.zoom <= zoomMin + 0.001}
        >
          −
        </button>
        <input
          id="zoom-slider"
          type="range"
          className="zoom-range"
          min={zoomMin}
          max={MAX_ZOOM}
          step="0.01"
          value={selectedItem.crop.zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          aria-label="Zoom in"
          onClick={() => setZoom(selectedItem.crop.zoom + 0.1)}
          disabled={selectedItem.crop.zoom >= MAX_ZOOM - 0.001}
        >
          +
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={resetFraming}
        >
          Reset Framing
        </button>
      </div>
    </>
  );

  const renderFitModeControls = () => (
    <div className="segmented-group" role="group" aria-label="Framing mode">
      <button
        type="button"
        className="segmented-btn"
        aria-pressed={selectedItem.fitMode === FIT_MODES.FILL}
        onClick={() => setFitMode(FIT_MODES.FILL)}
      >
        Fill (Borderless)
      </button>
      <button
        type="button"
        className="segmented-btn"
        aria-pressed={selectedItem.fitMode === FIT_MODES.BORDERS}
        onClick={() => setFitMode(FIT_MODES.BORDERS)}
      >
        White Borders
      </button>
    </div>
  );

  const renderPpiStatus = () =>
    effectivePpiInfo && (
      <div
        className={`alert-box ${effectivePpiInfo.isBelowTarget ? 'alert-warn' : 'meta-pill'}`}
        data-testid="ppi-status"
      >
        <div>
          Source detail: <strong>~{effectivePpiInfo.roundedPpi} PPI</strong>
          {' '}({selectedItem.naturalWidth} × {selectedItem.naturalHeight} px original) vs.{' '}
          <strong>{DPI} PPI</strong> target.
        </div>
        {effectivePpiInfo.isBelowTarget && (
          <div style={{ marginTop: 4 }}>
            Below 300 PPI: file will still export at {previewDims.widthPx} × {previewDims.heightPx} px,
            but upscaling does not create extra photo detail.
          </div>
        )}
      </div>
    );

  const renderSingleDownloadBtn = () => (
    <button
      type="button"
      className="btn btn-primary btn-full"
      onClick={handleDownloadSingle}
      disabled={!canExportSingle}
    >
      {isExporting
        ? 'Generating JPEG…'
        : `Download ${formatCm(previewDims.widthCm)}×${formatCm(previewDims.heightCm)} cm Crop`}
    </button>
  );

  const renderUploadButton = () => (
    <label
      htmlFor="file-upload"
      className="btn btn-dark btn-full"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInputRef.current?.click();
        }
      }}
    >
      Upload Images
    </label>
  );

  const renderStage = () => (
    <main className="stage-main">
      <div
        ref={containerRef}
        className={`viewport-container ${!selectedItem || selectedItem.status !== 'ready' ? 'is-idle' : ''} ${isDragging ? 'is-dragging' : ''}`}
        tabIndex={0}
        role="region"
        aria-label="Photo crop viewport. Drag with mouse or touch, or use arrow keys to pan, plus and minus to zoom, and 0 to reset framing."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointerGesture}
        onPointerCancel={endPointerGesture}
        onLostPointerCapture={endPointerGesture}
        onKeyDown={handleStageKeyDown}
      >
        {selectedItem?.status === 'ready' ? (
          <>
            <canvas ref={canvasRef} className="stage-canvas" />
            {stageLayout && (
              <div
                className="mask-frame"
                data-testid="mask-frame"
                data-mask-x={stageLayout.maskRect.x.toFixed(2)}
                data-mask-y={stageLayout.maskRect.y.toFixed(2)}
                data-mask-w={stageLayout.maskRect.width.toFixed(2)}
                data-mask-h={stageLayout.maskRect.height.toFixed(2)}
                data-crop-cx={selectedItem.crop.centerX.toFixed(6)}
                data-crop-cy={selectedItem.crop.centerY.toFixed(6)}
                data-crop-zoom={selectedItem.crop.zoom.toFixed(6)}
                style={{
                  left: `${stageLayout.maskRect.x}px`,
                  top: `${stageLayout.maskRect.y}px`,
                  width: `${stageLayout.maskRect.width}px`,
                  height: `${stageLayout.maskRect.height}px`,
                }}
              />
            )}
          </>
        ) : (
          <div className="stage-empty-card">
            <p className="stage-empty-title">
              {selectedItem?.status === 'loading'
                ? 'Decoding Image…'
                : selectedItem?.status === 'error'
                  ? 'Unable to Load Image'
                  : 'No Image Selected'}
            </p>
            <p className="stage-empty-desc">
              {selectedItem?.status === 'error'
                ? selectedItem.error
                : 'Upload one or more photos to crop for 300 PPI printing.'}
            </p>
          </div>
        )}
      </div>

      <div className="stage-footer-pill">
        {selectedItem?.fitMode === FIT_MODES.BORDERS
          ? `Preview • ${DPI} DPI JPEG (White Borders Allowed)`
          : `Preview • ${DPI} DPI Borderless JPEG`}
      </div>
    </main>
  );

  return (
    <div className="app-shell" data-layout-mode={isCompact ? 'mobile' : 'desktop'}>
      {/* Mounted unconditionally so file uploads work regardless of active tab or device mode */}
      <input
        ref={fileInputRef}
        id="file-upload"
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileUpload}
        className="sr-only"
      />

      {!isCompact ? (
        <>
          <aside className="sidebar" aria-label="Crop and print settings">
            <header className="app-header">
              <h1 className="app-title">
                Simple Photo Cropper <span className="app-title-accent">300 PPI</span>
              </h1>
              <p className="app-subtitle">
                Local client-side print preparation — photos stay on your device.
              </p>
            </header>

            <section className="panel-section" aria-labelledby="heading-print-size">
              <h2 id="heading-print-size" className="section-label">
                1. Target Print Size
              </h2>
              {renderSizeControls()}
              {outputSpec.valid && renderOutputSpecPill()}
            </section>

            <section className="panel-section" aria-labelledby="heading-batch">
              <div className="section-heading-row">
                <h2 id="heading-batch" className="section-label">
                  2. Manage Batch ({images.length})
                </h2>
                <button
                  type="button"
                  className="btn btn-danger-ghost"
                  onClick={clearBatch}
                  disabled={images.length === 0}
                >
                  Clear All
                </button>
              </div>
              {renderUploadButton()}
              {renderBatchList()}
            </section>

            {selectedItem && (
              <section className="panel-section" aria-labelledby="heading-framing">
                <div className="section-heading-row">
                  <h2 id="heading-framing" className="section-label">
                    3. Framing &amp; Export
                  </h2>
                </div>

                {selectedItem.status === 'error' && (
                  <div className="alert-box alert-error" role="alert">
                    {selectedItem.error}
                  </div>
                )}

                {selectedItem.status === 'loading' && (
                  <div className="alert-box alert-info">Decoding "{selectedItem.name}"…</div>
                )}

                {selectedItem.status === 'ready' && (
                  <>
                    {renderFitModeControls()}
                    {renderZoomControls()}
                    {renderPpiStatus()}
                    {renderSingleDownloadBtn()}
                  </>
                )}
              </section>
            )}

            {images.length > 0 && (
              <section className="panel-section" aria-label="Batch ZIP export and status">
                {renderBatchZipControls()}
              </section>
            )}

            {errorMessage && (
              <div className="alert-box alert-error" role="alert" data-testid="global-error">
                {errorMessage}
              </div>
            )}

            <div className="meta-pill" role="status" aria-live="polite" data-testid="status-message">
              {statusMessage || 'Select or upload a photo to begin.'}
            </div>
          </aside>

          {renderStage()}
        </>
      ) : (
        <>
          <header className="mobile-topbar">
            <h1 className="mobile-topbar-title">
              Photo Cropper <span className="app-title-accent">300 PPI</span>
            </h1>
            <span className={`mobile-topbar-pill ${!outputSpec.valid ? 'is-error' : ''}`}>
              {outputSpec.valid
                ? `${formatCm(outputSpec.widthCm)}×${formatCm(outputSpec.heightCm)} cm • ${DPI} PPI`
                : 'Invalid size'}
            </span>
          </header>

          {renderStage()}

          <aside className="sidebar mobile-dock" aria-label="Crop and print controls">
            <div className="mobile-tabs" role="tablist" aria-label="Editor tabs">
              <button
                id="tab-photos"
                type="button"
                role="tab"
                className="mobile-tab-btn"
                aria-selected={mobileTab === 'photos'}
                aria-controls="panel-photos"
                data-testid="tab-photos"
                onClick={() => setMobileTab('photos')}
              >
                Photos ({images.length})
              </button>
              <button
                id="tab-size"
                type="button"
                role="tab"
                className="mobile-tab-btn"
                aria-selected={mobileTab === 'size'}
                aria-controls="panel-size"
                data-testid="tab-size"
                onClick={() => setMobileTab('size')}
              >
                <span>Size</span>
                {!outputSpec.valid && <span className="tab-dot is-error" aria-hidden="true" />}
              </button>
              <button
                id="tab-crop"
                type="button"
                role="tab"
                className="mobile-tab-btn"
                aria-selected={mobileTab === 'crop'}
                aria-controls="panel-crop"
                data-testid="tab-crop"
                onClick={() => setMobileTab('crop')}
              >
                <span>Crop &amp; Save</span>
                {effectivePpiInfo?.isBelowTarget && <span className="tab-dot is-warn" aria-hidden="true" />}
              </button>
            </div>

            <div className="mobile-dock-body">
              {errorMessage && (
                <div className="alert-box alert-error" role="alert" data-testid="global-error">
                  {errorMessage}
                </div>
              )}

              {mobileTab === 'photos' && (
                <div
                  id="panel-photos"
                  role="tabpanel"
                  aria-labelledby="tab-photos"
                  className="mobile-tabpanel"
                >
                  <div className="batch-actions-row">
                    {renderUploadButton()}
                    <button
                      type="button"
                      className="btn btn-danger-ghost"
                      onClick={clearBatch}
                      disabled={images.length === 0}
                    >
                      Clear All
                    </button>
                  </div>

                  <CollapsibleSection
                    id="batch-list"
                    title="Batch Queue"
                    summary={`${images.length} photo${images.length === 1 ? '' : 's'}`}
                    open={mobileSections.batchList}
                    onToggle={() => toggleSection('batchList')}
                  >
                    {renderBatchList()}
                  </CollapsibleSection>

                  {images.length > 0 && (
                    <CollapsibleSection
                      id="batch-zip"
                      title="Batch ZIP Export"
                      summary={`${readyItems.length} ready`}
                      open={mobileSections.batchZip}
                      onToggle={() => toggleSection('batchZip')}
                    >
                      {renderBatchZipControls()}
                    </CollapsibleSection>
                  )}
                </div>
              )}

              {mobileTab === 'size' && (
                <div
                  id="panel-size"
                  role="tabpanel"
                  aria-labelledby="tab-size"
                  className="mobile-tabpanel"
                >
                  <CollapsibleSection
                    id="size-preset"
                    title="Print Size & Orientation"
                    summary={
                      outputSpec.valid
                        ? `${formatCm(outputSpec.widthCm)} × ${formatCm(outputSpec.heightCm)} cm`
                        : 'Invalid'
                    }
                    summaryTone={!outputSpec.valid ? 'error' : undefined}
                    open={mobileSections.sizePreset}
                    onToggle={() => toggleSection('sizePreset')}
                  >
                    {renderSizeControls()}
                  </CollapsibleSection>

                  <CollapsibleSection
                    id="size-specs"
                    title="Output Specs & Pixels"
                    summary={
                      outputSpec.valid
                        ? `${outputSpec.widthPx} × ${outputSpec.heightPx} px`
                        : 'Fix size above'
                    }
                    summaryTone={!outputSpec.valid ? 'error' : undefined}
                    open={mobileSections.sizeSpecs}
                    onToggle={() => toggleSection('sizeSpecs')}
                  >
                    {outputSpec.valid ? (
                      renderOutputSpecPill()
                    ) : (
                      <p className="help-note">
                        Fix the dimension errors above to view output pixel dimensions.
                      </p>
                    )}
                    <p className="help-note">
                      Exports target {DPI} PPI pixel dimensions with embedded JFIF resolution metadata.
                    </p>
                  </CollapsibleSection>
                </div>
              )}

              {mobileTab === 'crop' && (
                <div
                  id="panel-crop"
                  role="tabpanel"
                  aria-labelledby="tab-crop"
                  className="mobile-tabpanel"
                >
                  {!selectedItem && (
                    <div className="meta-pill" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span>No photo selected yet. Upload a photo first to crop and export.</span>
                      <button
                        type="button"
                        className="btn btn-dark btn-sm"
                        onClick={() => setMobileTab('photos')}
                      >
                        Go to Photos Tab
                      </button>
                    </div>
                  )}

                  {selectedItem?.status === 'loading' && (
                    <div className="alert-box alert-info">Decoding "{selectedItem.name}"…</div>
                  )}

                  {selectedItem?.status === 'error' && (
                    <div className="alert-box alert-error" role="alert">
                      {selectedItem.error}
                    </div>
                  )}

                  {selectedItem?.status === 'ready' && (
                    <>
                      <CollapsibleSection
                        id="crop-zoom"
                        title="Zoom & Framing"
                        summary={`${Math.round(selectedItem.crop.zoom * 100)}%`}
                        open={mobileSections.cropZoom}
                        onToggle={() => toggleSection('cropZoom')}
                      >
                        {renderZoomControls()}
                      </CollapsibleSection>

                      {renderSingleDownloadBtn()}

                      <CollapsibleSection
                        id="crop-mode"
                        title="Framing Mode"
                        summary={selectedItem.fitMode === FIT_MODES.BORDERS ? 'White Borders' : 'Fill'}
                        open={mobileSections.cropMode}
                        onToggle={() => toggleSection('cropMode')}
                      >
                        {renderFitModeControls()}
                      </CollapsibleSection>

                      {effectivePpiInfo && (
                        <CollapsibleSection
                          id="crop-ppi"
                          title="Print Quality"
                          summary={`~${effectivePpiInfo.roundedPpi} PPI`}
                          summaryTone={effectivePpiInfo.isBelowTarget ? 'warn' : undefined}
                          open={mobileSections.cropPpi}
                          onToggle={() => toggleSection('cropPpi')}
                        >
                          {renderPpiStatus()}
                        </CollapsibleSection>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="meta-pill" role="status" aria-live="polite" data-testid="status-message">
                {statusMessage || 'Select or upload a photo to begin.'}
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
