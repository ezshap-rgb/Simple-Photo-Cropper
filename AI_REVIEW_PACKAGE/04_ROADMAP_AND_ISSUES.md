# Development Status, Roadmap & Known Issues

## Completed Milestones & Current WIP
- **Completed (`1b0e68f` — `Initial commit`, 2026-07-21):** Delivered `index.html` (292 lines), `README.md`, and `.gitattributes` on branch `main` (in sync with `origin/main`). Includes metric print presets (`10x15`, `13x18`), custom cm dimensions, portrait/landscape orientation toggle, multi-image batch queue, interactive drag-pan and zoom-slider framing, and 300 DPI Blob JPEG download.
- **Current Work-in-Progress:** None. `git status` is clean, only `main` exists, and no `TODO`/`FIXME` markers appear in source.

---

## Known Bugs & Edge Cases (Verified in `index.html`)

| Severity | Issue & Location | Impact |
| :---: | :--- | :--- |
| **High** | **In-place state mutation in zoom slider** (`lines 237–239`): `n[currentIndex].zoom = v` mutates the item object inside `prev` directly before returning shallow array copy `n`. | Breaks React immutability/StrictMode assumptions and prevents safe memoization or undo history. |
| **High** | **Image reloaded & canvas reset on every pan/zoom tick** (`lines 83–114`): `draw` calls `new Image()`, sets `img.src`, and reassigns `canvas.width`/`height` inside `img.onload` on every `images` state change. | Causes flicker, repeated image decoding overhead, and potential out-of-order `onload` race conditions during rapid dragging or zooming. |
| **High** | **Viewport-pixel pan offsets + missing resize handling** (`lines 92–110, 118–126, 265–268`): `x`/`y` are stored in raw preview screen pixels, and neither `draw()` nor `.mask-frame` updates on window resize. | Resizing the browser window causes visual misalignment between `<canvas>` and `.mask-frame`, and alters the crop framing until manually re-triggered. |
| **High** | **Export failure permanently locks `isDownloading`** (`lines 132–180`): `download()` sets `isDownloading = true` with no `img.onerror`, no `try/catch`, and no `if (!blob)` guard in `exportCanvas.toBlob`. | Oversized custom canvas dimensions (exceeding browser max canvas limits) or decode errors leave the Download button permanently stuck on `"Generating..."`. |
| **Medium** | **Unvalidated custom print dimensions** (`lines 67, 205–206`): `parseFloat(customW) \|\| 10` accepts negative numbers (producing negative `maskDisplayW`/`pxW`) and arbitrarily large values; `0` silently reverts to `10`. | Negative dimensions break mask CSS and export; huge values crash or fail canvas allocation. |
| **Medium** | **Landscape orientation blindly swaps custom W/H** (`line 68`): `orientation === 'landscape'` always swaps `{ w: h, h: w }`, even if the user manually typed `customW = 20`, `customH = 10`. | Confusing dimension inversion when typing landscape custom sizes while `Landscape` is active. |
| **Medium** | **ObjectURL memory leaks & empty-file crash guard** (`lines 71–81, 176`): Upload `URL.createObjectURL(file)` URLs are never revoked; `<input>` value isn't reset (preventing re-upload of same file); `handleFile` doesn't guard `files.length === 0`, which would set `currentIndex(0)` and crash on `images[0].zoom` (`line 232`). Also, `line 176` calls `URL.revokeObjectURL(url)` synchronously right after `link.click()`. | Long sessions leak file memory; canceling or empty file events risk an uncaught TypeError; immediate revocation after `link.click()` can abort downloads in some browsers. |
| **Low** | **Colliding export filenames** (`line 172`): Every download uses `crop_${targetDim.w}x${targetDim.h}cm.jpg`, ignoring `imgData.name`. | Exporting multiple photos overwrites or forces OS `(1)`, `(2)` suffixes with no source name trace. |
| **Low** | **HiDPI blurriness & 2000px mask shadow cap** (`lines 34, 94–95`): Preview canvas ignores `window.devicePixelRatio`; `.mask-frame` uses `box-shadow: 0 0 0 2000px`. | Preview appears slightly soft on Retina/HiDPI displays, and the white scrim clips on viewports wider than 4000px. |
| **Low** | **Borderless badge vs. zoom-out contradiction & missing 300 DPI JPEG header** (`lines 163–168, 234, 281`): `min="0.1"` lets users zoom out to expose white margins despite `"Borderless"` notice; `toBlob` produces 300 DPI pixel counts without 300 DPI JFIF/EXIF metadata headers. | Printed output may have unintended white borders or default to 72/96 DPI in software reading physical print headers. |

---

## Incomplete Features & Technical Debt
- **Incomplete Features:** Batch "Download All" / ZIP export, delete/clear image controls, drag-and-drop file loading, touch/pointer pan & mouse-wheel zoom, 90° rotation / fine angle adjustment, center/reset/fit buttons, effective-DPI / low-resolution upscaling warning, output format options (PNG/WebP/quality).
- **Technical Debt:**
  - Uses React **development** UMD builds (`react.development.js`, `react-dom.development.js`) and runtime JSX compilation (`@babel/standalone`) + Tailwind Play CDN in production HTML.
  - External CDN links lack pinned minor/patch versions and Subresource Integrity (`integrity`) hashes.
  - Mask geometry math (`(targetDim / maxDim) * containerSize`) is duplicated 3 times (`lines 98–100`, `150–155`, `265–268`).
  - Zero automated unit/integration tests, linter, or type checking.

---

## Prioritized Next Steps

### P0 — Correctness, Stability & Framing Accuracy
1. Fix immutable state update in the zoom slider (`{ ...n[currentIndex], zoom: v }`).
2. Decode/cache loaded `HTMLImageElement` (or `ImageBitmap`) once on upload rather than calling `new Image()` on every `draw()`, and track container dimensions via `ResizeObserver`.
3. Store pan offsets (`x`, `y`) normalized relative to mask dimensions (instead of raw viewport pixels) and extract one shared geometry helper used by preview, mask overlay, and export.
4. Clamp/validate `customW`/`customH` (e.g., `0.5`–`100` cm, max canvas dimension guard) and add `img.onerror` + `if (!blob)` cleanup so `isDownloading` always resets.
5. Preserve source filenames on export (e.g., `${baseName}_crop_${w}x${h}cm.jpg`), defer `URL.revokeObjectURL` briefly (e.g., `setTimeout`), and revoke uploaded URLs on removal/unmount.

### P1 — Workflow & Print-Quality Enhancements
1. Add batch image removal / clear queue, "Reset Framing", and drag-and-drop upload.
2. Add Pointer Events (`onPointerDown`/`Move`/`Up`) + wheel zoom for touch/trackpad usability, plus keyboard nudging.
3. Display target pixel dimensions (`pxW × pxH`) and an effective-DPI / upscaling warning when source resolution falls below 300 DPI at the selected crop zoom.
4. Add "Download All" sequential export or client-side ZIP bundling.

### P2 — Production Hardening
1. Replace `.development.js` React scripts with pinned production builds + SRI hashes, or optionally bundle/inline dependencies for offline reliability.
2. Inject explicit 300 DPI JFIF `APP0` density bytes into exported JPEG blobs if required by print workflows.
