import {
  DPI,
  INCH_TO_CM,
  PRESETS,
  FIT_MODES,
  MIN_ZOOM_FILL,
  MIN_ZOOM_BORDERS,
  MAX_ZOOM,
} from './constants.js';

/**
 * Viewport-independent source-space crop model:
 * - centerX, centerY: normalized [0..1] point on the decoded source image placed at crop center.
 * - zoom: scale multiplier relative to cover-fit (zoom = 1 fills the crop frame along its tightest axis).
 */
export const DEFAULT_CROP = Object.freeze({
  centerX: 0.5,
  centerY: 0.5,
  zoom: 1.0,
});

export function cmToPixels(cm, dpi = DPI) {
  return Math.round((cm / INCH_TO_CM) * dpi);
}

export function getOutputPixelDimensions(widthCm, heightCm, dpi = DPI) {
  return {
    widthPx: cmToPixels(widthCm, dpi),
    heightPx: cmToPixels(heightCm, dpi),
  };
}

/**
 * Resolves effective output width/height in cm.
 * - Presets apply portrait/landscape orientation.
 * - Custom dimensions always display and export Width × Height directly with no hidden axis inversion.
 */
export function resolveEffectiveDimensions({ preset, orientation, customWidthCm, customHeightCm }) {
  if (preset in PRESETS) {
    const { w, h } = PRESETS[preset];
    return orientation === 'landscape'
      ? { widthCm: h, heightCm: w, preset }
      : { widthCm: w, heightCm: h, preset };
  }
  return {
    widthCm: customWidthCm,
    heightCm: customHeightCm,
    preset: 'custom',
  };
}

/**
 * Computes the visible rectangle in decoded source pixels for the given target aspect and crop.
 */
export function getVisibleSourceRect(srcW, srcH, targetAspect, crop = DEFAULT_CROP) {
  if (
    !Number.isFinite(srcW) || srcW <= 0 ||
    !Number.isFinite(srcH) || srcH <= 0 ||
    !Number.isFinite(targetAspect) || targetAspect <= 0
  ) {
    return null;
  }

  const zoom = Number.isFinite(crop?.zoom) && crop.zoom > 0 ? crop.zoom : 1;
  const centerX = Number.isFinite(crop?.centerX) ? crop.centerX : 0.5;
  const centerY = Number.isFinite(crop?.centerY) ? crop.centerY : 0.5;

  const srcAspect = srcW / srcH;
  const coverSrcW = srcAspect >= targetAspect ? srcH * targetAspect : srcW;
  const coverSrcH = srcAspect >= targetAspect ? srcH : srcW / targetAspect;

  const visibleSrcW = coverSrcW / zoom;
  const visibleSrcH = coverSrcH / zoom;

  const left = centerX * srcW - visibleSrcW / 2;
  const top = centerY * srcH - visibleSrcH / 2;

  return {
    left,
    top,
    width: visibleSrcW,
    height: visibleSrcH,
    coverSrcW,
    coverSrcH,
  };
}

/**
 * Enforces valid zoom and pan boundaries for the active fitMode:
 * - 'fill': zoom >= 1.0 and visible rectangle stays completely inside [0..srcW, 0..srcH] (zero exposed white edges).
 * - 'borders': zoom >= 0.1 and allows white borders while preventing the image from leaving the frame completely.
 */
export function clampCrop(crop, srcW, srcH, targetAspect, fitMode = FIT_MODES.FILL) {
  if (
    !Number.isFinite(srcW) || srcW <= 0 ||
    !Number.isFinite(srcH) || srcH <= 0 ||
    !Number.isFinite(targetAspect) || targetAspect <= 0
  ) {
    return { ...DEFAULT_CROP };
  }

  const minZoom = fitMode === FIT_MODES.FILL ? MIN_ZOOM_FILL : MIN_ZOOM_BORDERS;
  const rawZoom = Number.isFinite(crop?.zoom) ? crop.zoom : 1;
  const zoom = Math.min(MAX_ZOOM, Math.max(minZoom, rawZoom));

  const rawCx = Number.isFinite(crop?.centerX) ? crop.centerX : 0.5;
  const rawCy = Number.isFinite(crop?.centerY) ? crop.centerY : 0.5;

  const vis = getVisibleSourceRect(srcW, srcH, targetAspect, { centerX: 0.5, centerY: 0.5, zoom });
  const halfNormW = (vis.width / srcW) / 2;
  const halfNormH = (vis.height / srcH) / 2;

  let minCx;
  let maxCx;
  let minCy;
  let maxCy;

  if (fitMode === FIT_MODES.FILL) {
    minCx = halfNormW >= 0.5 ? 0.5 : halfNormW;
    maxCx = halfNormW >= 0.5 ? 0.5 : 1 - halfNormW;
    minCy = halfNormH >= 0.5 ? 0.5 : halfNormH;
    maxCy = halfNormH >= 0.5 ? 0.5 : 1 - halfNormH;
  } else {
    minCx = Math.min(0, 1 - halfNormW);
    maxCx = Math.max(1, halfNormW);
    minCy = Math.min(0, 1 - halfNormH);
    maxCy = Math.max(1, halfNormH);
  }

  return {
    centerX: Math.min(maxCx, Math.max(minCx, rawCx)),
    centerY: Math.min(maxCy, Math.max(minCy, rawCy)),
    zoom,
  };
}

/**
 * Policy for changes to print aspect ratio or fit mode:
 * Preserves the user's focal center and zoom where valid, then clamps cleanly to prevent invalid gaps.
 */
export function adaptCropForAspectChange(crop, srcW, srcH, nextAspect, fitMode = FIT_MODES.FILL) {
  return clampCrop(crop, srcW, srcH, nextAspect, fitMode);
}

/**
 * Authoritative stage & mask measurement shared by canvas drawing, CSS mask overlay, and hit/pan logic.
 * Returns null if the stage container is hidden or too small to measure safely.
 */
export function computeStageLayout(stageW, stageH, targetAspect) {
  if (
    !Number.isFinite(stageW) || !Number.isFinite(stageH) ||
    stageW < 8 || stageH < 8 ||
    !Number.isFinite(targetAspect) || targetAspect <= 0
  ) {
    return null;
  }

  const padding = Math.min(24, Math.min(stageW, stageH) * 0.08);
  const availW = Math.max(1, stageW - padding * 2);
  const availH = Math.max(1, stageH - padding * 2);

  let maskW = availW;
  let maskH = maskW / targetAspect;
  if (maskH > availH) {
    maskH = availH;
    maskW = maskH * targetAspect;
  }

  const x = (stageW - maskW) / 2;
  const y = (stageH - maskH) / 2;

  return {
    stageW,
    stageH,
    maskRect: {
      x,
      y,
      width: maskW,
      height: maskH,
    },
  };
}

/**
 * Single shared transform used identically for preview (destRect = layout.maskRect)
 * and 300-DPI export (destRect = { x: 0, y: 0, width: widthPx, height: heightPx }).
 */
export function computeImageDrawRect(srcW, srcH, destRect, crop = DEFAULT_CROP) {
  if (!destRect || destRect.width <= 0 || destRect.height <= 0) {
    return null;
  }
  const targetAspect = destRect.width / destRect.height;
  const vis = getVisibleSourceRect(srcW, srcH, targetAspect, crop);
  if (!vis) {
    return null;
  }

  const scale = destRect.width / vis.width;
  return {
    x: destRect.x - vis.left * scale,
    y: destRect.y - vis.top * scale,
    width: srcW * scale,
    height: srcH * scale,
    scale,
    visibleSourceRect: vis,
  };
}

/**
 * Converts pointer/keyboard CSS pixel movement into updated source-space crop coordinates.
 */
export function applyPanDelta(crop, dxCss, dyCss, srcW, srcH, destRect, fitMode = FIT_MODES.FILL) {
  const drawRect = computeImageDrawRect(srcW, srcH, destRect, crop);
  if (!drawRect || drawRect.scale <= 0) {
    return clampCrop(crop, srcW, srcH, destRect?.width / destRect?.height || 1, fitMode);
  }

  const dNormX = (dxCss / drawRect.scale) / srcW;
  const dNormY = (dyCss / drawRect.scale) / srcH;

  return clampCrop(
    {
      centerX: (crop?.centerX ?? 0.5) - dNormX,
      centerY: (crop?.centerY ?? 0.5) - dNormY,
      zoom: crop?.zoom ?? 1,
    },
    srcW,
    srcH,
    destRect.width / destRect.height,
    fitMode
  );
}

/**
 * Computes effective source PPI from actual source pixels mapped onto the physical print area.
 */
export function computeEffectiveSourcePpi(srcW, srcH, widthCm, heightCm, crop = DEFAULT_CROP, targetDpi = DPI) {
  if (
    !Number.isFinite(srcW) || srcW <= 0 ||
    !Number.isFinite(srcH) || srcH <= 0 ||
    !Number.isFinite(widthCm) || widthCm <= 0 ||
    !Number.isFinite(heightCm) || heightCm <= 0
  ) {
    return null;
  }

  const { widthPx, heightPx } = getOutputPixelDimensions(widthCm, heightCm, targetDpi);
  const targetAspect = widthPx / heightPx;
  const vis = getVisibleSourceRect(srcW, srcH, targetAspect, crop);
  if (!vis) {
    return null;
  }

  const widthInches = widthCm / INCH_TO_CM;
  const heightInches = heightCm / INCH_TO_CM;
  const ppiX = vis.width / widthInches;
  const ppiY = vis.height / heightInches;
  const effectivePpi = Math.min(ppiX, ppiY);

  return {
    ppiX,
    ppiY,
    effectivePpi,
    roundedPpi: Math.round(effectivePpi),
    isBelowTarget: effectivePpi < targetDpi - 0.5,
  };
}
