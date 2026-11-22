import {
  DPI,
  MIN_CM,
  MAX_CM,
  MAX_OUTPUT_SIDE_PX,
  MAX_OUTPUT_PIXELS,
} from './constants.js';
import { getOutputPixelDimensions } from './geometry.js';

const STRICT_NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

export function formatCm(value) {
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value * 100) / 100);
}

export function parseCustomCm(rawText, fieldLabel = 'Dimension') {
  const trimmed = String(rawText ?? '').trim();
  if (!trimmed) {
    return { valid: false, value: null, error: `${fieldLabel} is required.` };
  }
  if (!STRICT_NUMBER_RE.test(trimmed)) {
    return { valid: false, value: null, error: `${fieldLabel} must be a valid number.` };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { valid: false, value: null, error: `${fieldLabel} must be a finite number.` };
  }
  if (value <= 0) {
    return { valid: false, value: null, error: `${fieldLabel} must be greater than 0 cm.` };
  }
  if (value < MIN_CM) {
    return { valid: false, value: null, error: `${fieldLabel} must be at least ${MIN_CM} cm.` };
  }
  if (value > MAX_CM) {
    return { valid: false, value: null, error: `${fieldLabel} cannot exceed ${MAX_CM} cm.` };
  }
  return { valid: true, value, error: null };
}

export function validateOutputDimensions(widthCm, heightCm, dpi = DPI) {
  if (!Number.isFinite(widthCm) || !Number.isFinite(heightCm)) {
    return {
      valid: false,
      error: 'Output dimensions must be finite numbers.',
      widthPx: 0,
      heightPx: 0,
      totalPixels: 0,
      estimatedMb: 0,
    };
  }
  if (widthCm < MIN_CM || heightCm < MIN_CM) {
    return {
      valid: false,
      error: `Width and height must each be at least ${MIN_CM} cm.`,
      widthPx: 0,
      heightPx: 0,
      totalPixels: 0,
      estimatedMb: 0,
    };
  }
  if (widthCm > MAX_CM || heightCm > MAX_CM) {
    return {
      valid: false,
      error: `Width and height cannot exceed ${MAX_CM} cm (keeps output within safe device memory limits).`,
      widthPx: 0,
      heightPx: 0,
      totalPixels: 0,
      estimatedMb: 0,
    };
  }
  if (!Number.isInteger(dpi) || dpi <= 0 || dpi > 2400) {
    return {
      valid: false,
      error: 'Unsupported DPI setting.',
      widthPx: 0,
      heightPx: 0,
      totalPixels: 0,
      estimatedMb: 0,
    };
  }

  const { widthPx, heightPx } = getOutputPixelDimensions(widthCm, heightCm, dpi);
  const totalPixels = widthPx * heightPx;
  const estimatedMb = Math.round(((totalPixels * 4) / (1024 * 1024)) * 10) / 10;

  if (widthPx < 1 || heightPx < 1) {
    return {
      valid: false,
      error: 'Output pixel dimensions must be at least 1 × 1 px.',
      widthPx,
      heightPx,
      totalPixels,
      estimatedMb,
    };
  }
  if (widthPx > MAX_OUTPUT_SIDE_PX || heightPx > MAX_OUTPUT_SIDE_PX) {
    return {
      valid: false,
      error: `Output size (${widthPx} × ${heightPx} px) exceeds the ${MAX_OUTPUT_SIDE_PX.toLocaleString()} px maximum side limit.`,
      widthPx,
      heightPx,
      totalPixels,
      estimatedMb,
    };
  }
  if (totalPixels > MAX_OUTPUT_PIXELS) {
    return {
      valid: false,
      error: `Output area (${totalPixels.toLocaleString()} px, ~${estimatedMb} MB RGBA) exceeds the ${MAX_OUTPUT_PIXELS.toLocaleString()} px safety limit. Reduce width or height.`,
      widthPx,
      heightPx,
      totalPixels,
      estimatedMb,
    };
  }

  return {
    valid: true,
    error: null,
    widthPx,
    heightPx,
    totalPixels,
    estimatedMb,
  };
}

export function sanitizeBasename(filename) {
  const raw = String(filename || 'photo').split(/[\\/]/).pop() || 'photo';
  const dotIdx = raw.lastIndexOf('.');
  const withoutExt = dotIdx > 0 ? raw.slice(0, dotIdx) : raw;
  const cleaned = withoutExt
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || 'photo';
}

export function buildExportFilename(sourceName, widthCm, heightCm, usedNamesSet = null, dpi = DPI) {
  const base = sanitizeBasename(sourceName);
  const dimLabel = `${formatCm(widthCm)}x${formatCm(heightCm)}cm_${dpi}dpi`;
  let candidate = `${base}_${dimLabel}.jpg`;
  if (usedNamesSet) {
    let counter = 2;
    while (usedNamesSet.has(candidate.toLowerCase())) {
      candidate = `${base}_${dimLabel}_${counter}.jpg`;
      counter += 1;
    }
    usedNamesSet.add(candidate.toLowerCase());
  }
  return candidate;
}
