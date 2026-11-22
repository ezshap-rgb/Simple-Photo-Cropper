export const DPI = 300;
export const INCH_TO_CM = 2.54;
export const JPEG_QUALITY = 0.95;

export const PRESETS = Object.freeze({
  '10x15': Object.freeze({ w: 10, h: 15, label: '10 × 15 cm (Standard)' }),
  '13x18': Object.freeze({ w: 13, h: 18, label: '13 × 18 cm (Large)' }),
});

export const FIT_MODES = Object.freeze({
  FILL: 'fill',
  BORDERS: 'borders',
});

// Conservative print & device safety limits (never allocate huge canvases silently)
export const MIN_CM = 1;
export const MAX_CM = 65; // ~7,677 px @ 300 DPI; avoids 100 cm (~11,811 px / ~558 MB RGBA) browser OOMs
export const MAX_OUTPUT_SIDE_PX = 8192;
export const MAX_OUTPUT_PIXELS = 33_554_432; // ~134 MB RGBA backing store at 4 bytes/px

export const MAX_SOURCE_SIDE_PX = 16384;
export const MAX_SOURCE_PIXELS = 100_000_000;
export const MAX_SOURCE_FILE_BYTES = 50 * 1024 * 1024; // 50 MiB per file

export const MIN_ZOOM_FILL = 1.0;
export const MIN_ZOOM_BORDERS = 0.1;
export const MAX_ZOOM = 5.0;

export const DECODE_CONCURRENCY = 2;
export const DECODED_CACHE_LIMIT = 8;
export const MAX_BATCH_FILES = 50;
export const MAX_ZIP_ARCHIVE_BYTES = 120 * 1024 * 1024; // 120 MiB cumulative encoded JPEG budget
export const DOWNLOAD_REVOKE_DELAY_MS = 30_000;
