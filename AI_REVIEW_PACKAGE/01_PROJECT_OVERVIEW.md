# Project Overview

## Identity & Naming Variance
- **Repository & Documentation Name:** `Simple Photo Cropper` **[Documented]** (repository folder name and `README.md`).
- **Browser Tab Title:** `Photo Precision Cropper v4` **[Implemented]** (`index.html` line 6).
- **In-App Heading & Subtitle:** `Photo Cropper v4` — *"Fixed Download & Orientation"* **[Implemented]** (`index.html` lines 186–187).
- **Versioning Note:** Although labeled `v4` in the UI, git history begins at a single `Initial commit` (`1b0e68f`, dated 2026-07-21); no `v1`–`v3` commits exist in the repository **[Documented]**.

---

## Core Problem Solved & Product Philosophy
- **Core Problem:** Preparing digital photos to match exact physical print dimensions (in centimeters) so images do not suffer unexpected printer auto-cropping or aspect-ratio distortion when printed **[Documented]** / **[Implemented]**.
- **Target Users:** Home users, hobbyist photographers, and walk-in/online print-lab customers preparing single photos or small batches for common metric print formats (10×15 cm, 13×18 cm, or custom cm dimensions) **[Inferred]**.
- **Product Philosophy:**
  - **Zero-Build, Single-File Simplicity:** Entire application ships inside one 292-line `index.html` file with no local build toolchain, package manager, or installation step **[Implemented]**.
  - **Client-Side Privacy & Speed:** All image loading, preview rendering, and 300 DPI canvas rasterization run locally in the browser; user photos are never uploaded to any server **[Implemented]**.
  - **Focused Minimalism:** Exposes only essential print-prep controls (target dimensions, orientation, batch selection, pan, zoom, and JPEG export) without multi-tool editor bloat **[Implemented]** / **[Inferred]**.

---

## Primary Workflows
1. **Configure Print Target:** Select a preset (`10x15` cm or `13x18` cm) or `custom` width/height in cm, then choose `Portrait` or `Landscape` orientation (`index.html` lines 191–209) **[Implemented]**.
2. **Load Photo Batch:** Click `Upload Images` (`<input type="file" multiple accept="image/*">`) to queue one or more local image files into the sidebar list; the first uploaded photo is automatically selected when no photo is active (`index.html` lines 71–81, 212–225) **[Implemented]**.
3. **Frame & Scale:** Inspect the live canvas behind a centered blue-bordered crop mask (`.mask-frame` with a 70% white surrounding scrim), pan via click-and-drag, and scale via the `Crop Zoom` slider (`10%` to `500%`, `step="0.01"`) (`index.html` lines 229–241, 254–268) **[Implemented]**.
4. **Export Print-Ready JPEG:** Click `Download {w}x{h}cm Crop` to render an offscreen 300 DPI canvas (`Math.round((cm / 2.54) * 300)` pixels) over a white background and trigger a `Blob`-backed JPEG download (`quality = 0.95`) (`index.html` lines 132–180, 242–248) **[Implemented]**.

---

## Current Stage & Feature Inventory
- **Current Stage:** Functional v4 single-file prototype (`Initial commit` `1b0e68f` on `main`, working tree clean) **[Documented]** / **[Implemented]**.

### Completed Features **[Implemented]**
- Metric print presets (`10 x 15 cm (Standard)`, `13 x 18 cm (Large)`) and `Custom Size` width/height inputs (`cm`).
- Global `Portrait` / `Landscape` orientation switcher (`w` and `h` swap).
- Multi-file image upload and sidebar batch selector with per-image independent `{ x, y, zoom }` framing state.
- Live HTML5 `<canvas>` preview with proportional crop overlay mask and white background fill.
- 300 DPI pixel-dimension calculation and `canvas.toBlob(..., 'image/jpeg', 0.95)` download flow.

### Planned / Unfinished Features
- **Formal Roadmap Status:** No roadmap, issue tracker, spec, or `TODO` list exists anywhere in the repository **[Documented]**.
- **Likely Next Capabilities:** Batch "Download All" / ZIP export, per-image removal or batch reset, mobile/touch pan-zoom support, image rotation/straightening, and source resolution / effective-DPI upscaling warnings **[Inferred]**.

---

## Known Limitations **[Implemented]**
- **Internet Required at Load Time:** Depends on 4 external CDN scripts (`unpkg.com` React/ReactDOM/Babel and `cdn.tailwindcss.com`), preventing offline use.
- **No Automated Batch Export:** Users must select and click Download individually for every photo, and all downloads share the generic filename `crop_{w}x{h}cm.jpg`.
- **Desktop Mouse-Only Interaction:** Pan relies solely on `onMouseDown`/`onMouseMove`/`onMouseUp`/`onMouseLeave`; no touch events, pointer events, or wheel/pinch zoom exist.
- **No Window Resize Adaptation:** Preview sizing is computed from `containerRef.current.clientWidth/Height` during `draw()`, without a `ResizeObserver` or window `resize` listener.
- **No Persistence:** Refreshing or closing the tab discards the entire batch and all framing adjustments.
- **No DPI Header Metadata or Upscaling Guard:** Exported JPEGs contain 300-DPI-scaled pixel dimensions, but standard `canvas.toBlob` omits explicit 300 DPI JFIF/EXIF tags and provides no warning when enlarging low-resolution photos.
- **Unvalidated Custom Inputs:** Custom cm inputs accept negative, zero (`|| 10` fallback), or browser-crashing oversized dimensions.

---

## Long-Term Vision **[Inferred]**
- No vision statement beyond the one-sentence `README.md` exists in the repository **[Documented]**. Based on the current implementation, the natural long-term trajectory is a fast, zero-upload, privacy-first browser utility for everyday print preparation—potentially evolving to support offline/PWA caching, one-click multi-photo batch ZIP export, embedded print DPI headers, and resolution quality checks while keeping deployment and UX friction near zero **[Inferred]**.
