# Simple Photo Cropper

A local, privacy-preserving browser utility for cropping photos to exact metric print sizes (`round(cm / 2.54 × 300)` pixels at 300 PPI) and exporting print-ready JPEGs.

## Running the App
- **End users (offline or hosted):** Open `index.html` directly by double-clicking it (`file://`) or serve the repository root on any static host (e.g., GitHub Pages). `index.html` is fully self-contained with zero CDN or backend requests and requires no Node.js runtime.
- **Developers:**
  ```bash
  npm install
  npm run build        # Rebuilds self-contained offline root index.html
  npm run test:unit    # Runs geometry, validation, JPEG metadata, and ZIP unit tests
  npm run test:browser # Runs browser end-to-end checks on built index.html
  npm test             # Builds + runs unit and browser suites
  ```

## Adaptive Layout & Workflow
- **Desktop / Landscape (`>= 768px` landscape):** Fixed left control sidebar alongside the live crop viewport.
- **Mobile / Portrait (`<= 767px`, or portrait tablets `<= 1024px`):** Pinned viewing window on top with zero horizontal scroll and three tabs beneath (**Photos**, **Size**, **Crop & Save**) containing collapsible sections so active controls stay directly under the preview.

## Supported Formats & Browsers
- **Input:** Any image format decoded natively by your browser (JPEG, PNG, WebP, etc.). Transparent PNG/WebP areas and **White Borders** framing composite onto solid white (`#ffffff`).
- **Output:** Single JPEG (`quality = 0.95`) with JFIF 300 PPI density metadata, or a sequential client-side STORE-mode `.zip` archive via **Download All**.
- **Browsers tested:** Modern Chromium browsers (Chrome and Edge on Windows desktop, portrait tablet, and mobile viewports down to `320 px`). Firefox, Safari, and physical mobile devices were not run in automated checks.

## Print Settings & Resource Limits
- **Custom & Preset Dimensions:** `10 × 15 cm` (`1181 × 1772 px`), `13 × 18 cm` (`1535 × 2126 px`), or custom `1–65 cm` width/height (`max 8,192 px` per side, `33,554,432 px` total area).
- **Source Limits & Batch Budget:** Up to `50 MB` per file, `16,384 px` per side (`100 MP`), `50` files per batch, decode concurrency `2`, LRU decode cache `8` images, and `120 MB` cumulative ZIP export memory budget.
- **DPI Metadata Caveat:** Exported JPEGs set JFIF `300 PPI` density tags (and keep existing EXIF resolution tags consistent), which helps many print workflows—always confirm matching paper size and fit/borderless options in your printer driver or photo lab.

## Known Limitations
- Automated verification ran in Chromium desktop/emulated portrait viewports rather than physical mobile devices, Firefox, or Safari.
- Browser file-download prompts and user save locations are controlled by the browser; the app verifies valid JPEG/ZIP Blob generation rather than disk write completion.
- Exports JPEG only (no PNG/TIFF output).
