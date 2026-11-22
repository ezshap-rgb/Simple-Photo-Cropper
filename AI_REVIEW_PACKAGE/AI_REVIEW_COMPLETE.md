# Independent AI Architecture & Code Review Package

> **INSTRUCTIONS FOR REVIEWER AI (Claude / ChatGPT):**
> Act as a Principal Software Architect, Staff Engineer, and Product Design Consultant.
> Read this entire self-contained package carefully—especially **Section 3 (Confirmed vs. Inferred Decisions & Constraints)** so you do not recommend approaches that were already intentionally rejected.
>
> Organize your critique into these four actionable sections so I can bring your feedback directly back into my coding agent (Antigravity):
> 1. **Critical Architectural & Structural Risks** (bottlenecks, state bugs, scaling limits, security gaps)
> 2. **High-Leverage Quick Wins & Bug Fixes** (specific file/function improvements with clear reasoning)
> 3. **Product & UX Alignment Gaps** (where the current implementation falls short of the stated user workflows)
> 4. **Ready-to-Run Antigravity Implementation Prompts** (2–4 self-contained prompts I can paste directly into Antigravity to execute your highest-priority recommendations safely)

---

## Part 1 — Project Overview & Product Vision

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

---

## Part 2 — Architecture & Technical Implementation

# Architecture & Technical Implementation

## Technology Stack
- **Markup & Styling:** HTML5, inline `<style>` CSS3 (`index.html` lines 17–38), and Tailwind CSS Play CDN JIT runtime (`https://cdn.tailwindcss.com`, line 16).
- **Logic & UI Runtime:** ES6+ JavaScript and JSX transpiled in-browser via `@babel/standalone` (`https://unpkg.com/@babel/standalone/babel.min.js`, line 9) using a custom `react-classic` preset (`lines 10–15`) targeting React 18 UMD development builds (`react@18/umd/react.development.js` and `react-dom@18/umd/react-dom.development.js`, lines 7–8).
- **Graphics & Export:** Browser DOM HTML5 2D Canvas API (`CanvasRenderingContext2D`, `HTMLCanvasElement.toBlob`) and Object URLs (`URL.createObjectURL` / `URL.revokeObjectURL`).

---

## Directory Tree & Module Organization
```text
Simple Photo Cropper/
├── .gitattributes    # LF normalization config (* text=auto)
├── README.md         # One-sentence project summary
└── index.html        # Complete application (HTML shell, CSS, Babel preset, React App)
```
- **Entry Point:** `index.html` mounts `<App />` into `<div id="root">` via `ReactDOM.createRoot` (`lines 288–289`).
- **Module Organization:** Strictly monolithic—one `<script type="text/babel" data-presets="react-classic">` block (`lines 43–290`) containing a single `App` functional component (`lines 46–286`) with no external modules, components, or helpers.

---

## Data Models & In-Memory State Schema
All application state lives inside `App` via React hooks (no Context, Redux, or external store):

| State / Ref / Memo | Type & Initial Value | Purpose & Scope |
| :--- | :--- | :--- |
| `images` | `Array<{ file: File, url: string, name: string, x: number, y: number, zoom: number }>` (`[]`) | Uploaded batch items; `x`/`y` are pan offsets in **live viewport CSS pixels**, `zoom` defaults to `1` (`0.1`–`5.0`). |
| `currentIndex` | `number \| null` (`null`) | Active index into `images`. |
| `preset` | `'10x15' \| '13x18' \| 'custom'` (`'10x15'`) | Selected physical print preset. |
| `orientation` | `'portrait' \| 'landscape'` (`'portrait'`) | Controls whether `targetDim` returns `{ w, h }` or `{ w: h, h: w }`. |
| `customW`, `customH` | `number \| string` (`10`, `10`) | Raw values from custom width/height `<input type="number">` fields. |
| `isDragging` | `boolean` (`false`) | Tracks active mouse drag inside `.viewport-container`. |
| `dragStart` | `{ x: number, y: number }` (`{ x: 0, y: 0 }`) | Last recorded `clientX`/`clientY` during drag. |
| `isDownloading` | `boolean` (`false`) | Disables export button while `Image.onload` and `toBlob` run. |
| `targetDim` | `{ w: number, h: number }` (`useMemo`) | Effective target physical size in cm (`lines 63–69`). |
| `canvasRef`, `containerRef` | `React.MutableRefObject` | DOM references to preview `<canvas>` and `.viewport-container`. |

---

## Coordinate Mapping & 300 DPI Export Pipeline
Constants: `DPI = 300`, `INCH_TO_CM = 2.54` (`lines 60–61`).

1. **Preview Sizing (`draw`, lines 92–110):**
   - `containerSize = Math.min(container.clientWidth, container.clientHeight) * 0.9`
   - `maxDim = Math.max(targetDim.w, targetDim.h)`
   - `maskDisplayW = (targetDim.w / maxDim) * containerSize` (and similarly `maskDisplayH` for `targetDim.h`)
   - `baseScale = Math.max(maskDisplayW / img.width, maskDisplayH / img.height)` ("cover" fit)
   - `finalScale = baseScale * imgData.zoom`
   - `x = (canvas.width / 2) + imgData.x - (w / 2)`, `y = (canvas.height / 2) + imgData.y - (h / 2)`
2. **Export Scaling (`download`, lines 141–165):**
   - Output pixel dimensions: `pxW = Math.round((targetDim.w / 2.54) * 300)`, `pxH = Math.round((targetDim.h / 2.54) * 300)`.
   - Viewport-to-print multiplier: `ratio = pxW / maskDisplayW`.
   - Draws white background (`#ffffff`), scales image by `baseScale * imgData.zoom * ratio`, offsets by `imgData.x * ratio` and `imgData.y * ratio`, and exports `'image/jpeg'` at `0.95` quality.

| Preset / Mode | Physical Size (cm) | Portrait Export (px) | Landscape Export (px) |
| :--- | :---: | :---: | :---: |
| `10x15` | 10 × 15 cm | 1181 × 1772 px | 1772 × 1181 px |
| `13x18` | 13 × 18 cm | 1535 × 2126 px | 2126 × 1535 px |
| `custom` (default) | 10 × 10 cm | 1181 × 1181 px | 1181 × 1181 px |

---

## Subsystems & Infrastructure Audit
- **Local / Remote Storage:** None (`localStorage`, `sessionStorage`, `IndexedDB`, cookies, and remote DBs are unused). Only ephemeral in-memory `Blob` ObjectURLs exist per tab session.
- **State Management:** Local React `useState` / `useMemo` / `useCallback` / `useRef` within `App`.
- **Routing:** None (single-screen application).
- **External APIs:** None for application data. Runtime depends on 4 GET script requests to `unpkg.com` and `cdn.tailwindcss.com`.
- **Auth & Security:** No authentication or user accounts. High user-image privacy (zero uploads), but weak supply-chain hardening: unpinned CDN tags (`react@18`, `@babel/standalone`, `cdn.tailwindcss.com`), React **development** builds loaded in production HTML, no Subresource Integrity (`integrity="..."`) hashes, and no Content Security Policy (`CSP`).
- **Background Jobs:** None. Rendering happens on `img.onload` inside `useEffect`, and export uses asynchronous `img.onload` + `exportCanvas.toBlob(...)` callbacks.
- **Build & Deploy Pipeline:** None (`package.json`, bundler, linter, tests, and CI/CD configs are absent). Directly deployable on any static host (e.g., GitHub Pages) or opened locally with internet access.

---

## Data Flow Diagram
```text
[Local File Picker (<input multiple>)]
       │ URL.createObjectURL(file)
       ▼
[React State: images[], currentIndex] ◄─── [Sidebar Controls: Preset, Orientation, Custom W/H, Zoom Slider]
       │                               ▲
       │ triggers useEffect(draw)      │ updates x, y (Mouse Drag)
       ▼                               │
[Preview Pipeline: new Image() -> canvasRef (centered + maskDisplayW/H)]
       │                               │
       │ overlays                      │ reads containerRef size
       ▼                               ▼
[CSS .mask-frame (2px #2563eb border + 70% white scrim)]

[Download Button Click]
       │ creates offscreen <canvas> (pxW x pxH @ 300 DPI)
       ▼
[Offscreen Draw: white fill + image scaled by ratio = pxW / maskDisplayW]
       │ exportCanvas.toBlob('image/jpeg', 0.95)
       ▼
[Temporary ObjectURL -> <a download="crop_WxHcm.jpg">.click() -> URL.revokeObjectURL]
```

---

## Part 3 — Architectural Decisions & Constraints

# Architectural Decisions & Constraints

> Every point below is explicitly categorized as **Confirmed** (verified directly in source comments, code, or `README.md`), **Inferred** (strongly implied by implementation structure, with no design doc on record), or **Open Question** (unresolved ambiguity requiring owner input). No commit history prior to `1b0e68f` exists or is assumed.

---

## Major Decisions Made & Alternatives Rejected

### 1. Lock `@babel/standalone` to Classic React Runtime (**Confirmed**)
- **Decision:** Register a custom Babel preset `'react-classic'` setting `{ runtime: 'classic' }` (`index.html` lines 10–15) and apply `data-presets="react-classic"` to the application script (`line 43`).
- **Why:** Explicitly documented on line 11 (`// Explicitly lock the standalone compiler to the UMD classic runtime`) so JSX compiles to `React.createElement(...)` rather than ES-module `react/jsx-runtime` imports unavailable in UMD globals.
- **Alternative Rejected:** Automatic JSX runtime (`runtime: 'automatic'`), which breaks in a zero-bundler `<script>` UMD setup.

### 2. Use `canvas.toBlob()` Instead of `canvas.toDataURL()` for Exports (**Confirmed**)
- **Decision:** Export the offscreen 300 DPI canvas via `exportCanvas.toBlob(..., 'image/jpeg', 0.95)` combined with `URL.createObjectURL(blob)` (`index.html` lines 167–178).
- **Why:** Explicitly documented on line 167 (`// Blob-based download is more reliable than DataURL`). Large print canvases (e.g., 13×18 cm = 1535×2126 px, or larger custom prints) produce multi-megabyte base64 strings that can hit browser URL length limits or spike memory.
- **Alternative Rejected:** `exportCanvas.toDataURL('image/jpeg', 0.95)` assigned directly to `<a href>`.

### 3. Metric Centimeters, Fixed 300 DPI Scaling, White Fill, and JPEG `0.95` (**Confirmed**)
- **Decision:** Compute target pixel dimensions using `DPI = 300` and `INCH_TO_CM = 2.54` (`lines 60–61, 142–143`), pre-fill the export canvas with `"white"` (`lines 163–164`), and output `'image/jpeg'` at `0.95` quality (`line 178`).
- **Why:** Aligns with `README.md` ("size the photo to a set canvas size when you are printing photos in a specific size") using standard 300 DPI photo-lab print density and clean white matting if an image is zoomed out or has transparency.
- **Alternatives Rejected:** Screen-DPI (72/96 DPI) exports, transparent PNG exports, or imperial-only sizing.

### 4. Version 4 Focus: Download Reliability & Portrait/Landscape Orientation (**Confirmed** / **Inferred**)
- **Decision:** Title and subtitle explicitly mark this iteration as `v4` — `"Fixed Download & Orientation"` (`index.html` lines 6, 186–187) (**Confirmed**).
- **Why:** Indicates earlier iterations (`v1`–`v3`, outside git history) suffered from export failures (`DataURL` limits) and rigid/broken orientation switching, prompting the `toBlob` export and `targetDim` `w`/`h` swap logic (**Inferred**).

### 5. Zero-Build Single-HTML Distribution (**Inferred**)
- **Decision:** Ship everything in one `index.html` file with CDN scripts instead of Node.js, Vite, TypeScript, or npm dependencies.
- **Why:** Enables instant editing, single-file sharing, and zero-config GitHub Pages or local hosting without build tooling.
- **Alternatives Rejected:** Bundled SPA setup (`vite`, `webpack`, `package.json`), multi-file JS module tree, or server-rendered backend.

### 6. 100% Client-Side Processing (**Inferred**)
- **Decision:** Load images via `URL.createObjectURL(file)` and process pixels solely on HTML5 `<canvas>`.
- **Why:** Eliminates backend infrastructure, upload latency, bandwidth costs, and privacy concerns over personal photos.
- **Alternatives Rejected:** Server-side Sharp/ImageMagick/Pillow cropping endpoint.

### 7. Cover-Mode Base Scale + Global Print Size + Per-Image Framing (**Inferred**)
- **Decision:** Base scale uses `Math.max(maskDisplayW / img.width, maskDisplayH / img.height)` (`lines 102, 155`); `preset`/`orientation`/`customW`/`customH` are global, whereas `{ x, y, zoom }` are stored per image.
- **Why:** Most users print a batch onto one paper size/orientation while needing individual pan/zoom adjustments per photo, defaulting to borderless fill (`zoom = 1`).
- **Alternatives Rejected:** Per-image paper size settings or `Math.min` ("contain") default scaling that introduces white bars by default.

### 8. React + Tailwind via CDNs Over Vanilla JS/CSS (**Inferred**)
- **Decision:** Load React 18, Babel Standalone, and Tailwind Play CDN for a 292-line app.
- **Why:** Prioritizes fast declarative UI iteration over minimal payload size and offline independence.
- **Alternatives Rejected:** Zero-dependency vanilla DOM/Canvas JavaScript + CSS.

---

## Non-Negotiable Constraints
1. **300 DPI Print Dimension Accuracy (**Confirmed**):** Output pixel dimensions must accurately satisfy `Math.round((cm / 2.54) * 300)` and match the framed crop preview 1:1.
2. **Client-Side Execution Without Server Uploads (**Inferred**):** Photos must remain strictly local inside the user's browser session.
3. **Low Deployment & Usage Friction (**Inferred**):** Must remain effortless to host and run without complex backend services or user sign-in.

---

## Open Questions (**Open Question**)
1. **Zero-Build Mandate vs. Modern Tooling:** Must the app stay a single standalone `index.html` file (including runnable via `file://`), or is introducing a lightweight build pipeline (e.g., Vite + TypeScript + compiled Tailwind) acceptable?
2. **Offline Reliability:** Do users need this tool to work offline or behind restricted networks (requiring bundled assets or removal of `unpkg.com` / `cdn.tailwindcss.com`)?
3. **Physical DPI Metadata Headers:** Do target print shops/home printers require explicit 300 DPI JFIF `APP0`/EXIF tags injected into the exported JPEG binary, or do pixel dimensions alone suffice?
4. **Borderless vs. White-Margin Behavior:** The UI states *"Export will be 300 DPI Borderless"* (`line 281`), yet zoom allows `0.1` (`line 234`), creating white borders. Should zoom clamp at `>= 1.0`, or should white-bordered framing be an explicit option?
5. **Batch Workflow Expectations:** Should "Manage Batch" support a single-click "Download All" / ZIP archive and preserve original source filenames?
6. **Print Sizes & Units:** Are imperial presets (4×6", 5×7", 8×10"), A-series sizes (A4/A5), or per-image orientation auto-detection desired?
7. **Target Devices:** Is mobile/tablet touch support needed, or is desktop browser usage the sole priority?

---

## Part 4 — Development Status, Roadmap & Known Issues

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

---

## Part 5 — User Experience & Product Design

# User Experience & Product Design

## Main Screens & Layout Structure
The application uses a single split-pane desktop viewport (`flex h-screen w-screen overflow-hidden`, `index.html` lines 183–284) with no navigation bar, modals, or secondary routes:

1. **Left Control Sidebar (`<aside className="w-80 bg-white border-r p-6 ...">`, lines 184–251):**
   - **Header:** App title (`Photo Cropper v4`) and subtitle (`Fixed Download & Orientation`).
   - **Section 1 — Target Print Size (`lines 190–209`):** Preset `<select>` (`10 x 15 cm (Standard)`, `13 x 18 cm (Large)`, `Custom Size`), a 2-button segmented `Portrait` / `Landscape` toggle, and conditional 2-column numeric inputs (`Width (cm)`, `Height (cm)`) visible only when `preset === 'custom'`.
   - **Section 2 — Manage Batch (`lines 211–225`):** Dark `Upload Images` button (`bg-slate-800`) backed by a hidden `<input type="file" multiple accept="image/*">`, followed by a `max-h-48` scrollable list of numbered filenames (`1. photo.jpg`) or an italicized *"No images loaded"* placeholder.
   - **Bottom Active-Image Dock (`mt-auto`, lines 227–250):** Appears only when `currentIndex !== null`. Shows a `Crop Zoom` slider (`10%`–`500%` with monospace live percentage readout) and a green primary CTA (`Download {w}x{h}cm Crop` / `Generating...`).

2. **Main Crop Stage (`<main className="flex-1 ... bg-slate-200 relative">`, lines 253–283):**
   - **Empty State (`lines 270–278`):** Centered light icon with *"No Image Selected"* and *"Upload and select a photo from the sidebar"*.
   - **Active Canvas Viewport (`lines 254–269`):** `.viewport-container` (`cursor: move`, `#cbd5e1` background) centering the `<canvas>` beneath a non-interactive `.mask-frame` (`pointer-events: none`, `2px solid #2563eb` border, 70% opaque white scrim outside the crop box).
   - **Floating Status Pill (`lines 280–282`):** Bottom-right translucent badge reading `PREVIEW ONLY • EXPORT WILL BE 300 DPI BORDERLESS`.

---

## Primary User Journeys & Friction Points
- **Single-Photo Crop:** Upload 1 file → auto-selects index `0` → choose preset/orientation → drag photo inside frame & adjust zoom slider → click green Download button. *(Smooth and fast for single desktop edits.)*
- **Multi-Photo Batch Prep:** Upload N files → select item `1` → frame & download → manually click item `2` → frame & download → repeat. *(High friction: no "Download All" action, identical output filenames `crop_WxHcm.jpg`, no visual indicator of which photos were already exported or cropped.)*
- **Custom Landscape Sizing:** Select `Custom Size` → enter `15` width and `10` height while `Portrait` is active vs. switching to `Landscape` → switching to `Landscape` unconditionally swaps `w` and `h` (`line 68`), turning an already-landscape `15×10` entry into `10×15` portrait.

---

## Interaction Patterns & Visual Design
- **Direct Manipulation:** Mouse-only drag (`onMouseDown` / `onMouseMove` / `onMouseUp`) moves the underlying image beneath a fixed centered crop frame rather than dragging crop handles. Moving the cursor outside `.viewport-container` fires `onMouseLeave` (`line 260`), immediately terminating the drag.
- **Discrete Slider Zoom:** Zoom changes strictly via `<input type="range" min="0.1" max="5" step="0.01">`—no mouse wheel zoom, double-click reset, or +/- step buttons.
- **Visual Hierarchy:** Clean Tailwind Slate palette (`#f1f5f9` / `#cbd5e1` surfaces, `#ffffff` sidebar card, `#2563eb` blue for active state & crop boundary, `#16a34a` green reserved solely for the final Download action). Clear `1.` / `2.` step numbering establishes left-to-right, top-to-bottom workflow order.

---

## Accessibility Audit
- **Missing Programmatic Labels:** Only the file input (`id="fup"` / `htmlFor="fup"`) is properly associated; the preset `<select>`, custom width/height `<input>`s, and `Crop Zoom` range slider lack `id`/`htmlFor` or `aria-label` attributes.
- **Keyboard & Non-Mouse Gaps:** Image panning is completely inaccessible via keyboard (no arrow-key nudging); `Portrait`/`Landscape` buttons lack `aria-pressed`; batch items lack `aria-current="true"`; no `aria-live` announcements exist for image upload counts or export completion/errors.
- **Responsive & Visual Contrast Limits:** Fixed `w-80` (320px) sidebar alongside `h-screen w-screen overflow-hidden` leaves zero space on mobile viewports (`< 640px`) and has no touch event support. Low-contrast helper copy (`text-gray-400`, `text-[10px] text-slate-500`) may fail WCAG AA contrast thresholds.

---

## Incomplete UI Areas
- **No Drag-and-Drop Zone:** Dropping files onto the empty stage or viewport does nothing.
- **No Batch Management Controls:** Users cannot remove an individual image, clear the batch, reorder items, or see image thumbnails/export status badges.
- **No Framing Helpers:** Missing "Reset Position", "Fit / Fill", rule-of-thirds grid lines, or center snap guides.
- **No Output Quality Feedback:** UI does not display exported pixel dimensions (e.g., `1181 × 1772 px`) or warn when zooming in degrades print quality below 300 DPI.
- **Misleading Copy vs. Zoom Range:** Bottom badge promises *"300 DPI Borderless"*, yet zooming below `100%` or dragging edges inside the mask produces white borders without UI warning.

---

## Part 6 — Source Manifest

# Source Code Manifest

Total sanitized source files included: **3**

| Relative Path | Size (Bytes) | Est. Tokens | In Essential Bundle? |
| :--- | ---: | ---: | :---: |
| `.gitattributes` | 66 | ~16 | No |
| `index.html` | 16,069 | ~4,016 | Yes |
| `README.md` | 131 | ~32 | Yes |

---

## Part 7 — Complete Sanitized Source Code

### `.gitattributes`
```
# Auto detect text files and perform LF normalization
* text=auto

```

### `index.html`
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Photo Precision Cropper v4</title>
    <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script>
    // Explicitly lock the standalone compiler to the UMD classic runtime
    Babel.registerPreset('react-classic', {
        presets: [ [Babel.availablePresets['react'], { runtime: 'classic' }] ]
    });
</script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #f1f5f9; font-family: system-ui, -apple-system, sans-serif; height: 100vh; margin: 0; overflow: hidden; }
        .viewport-container {
            position: relative;
            width: 100%;
            height: 100%;
            background: #cbd5e1;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            cursor: move;
        }
        .mask-frame {
            position: absolute;
            pointer-events: none;
            border: 2px solid #2563eb;
            box-shadow: 0 0 0 2000px rgba(255, 255, 255, 0.7);
            z-index: 10;
        }
        canvas { background: white; }
    </style>
</head>
<body>
    <div id="root"></div>

    <script type="text/babel" data-presets="react-classic">
        const { useState, useRef, useEffect, useCallback, useMemo } = React;

        const App = () => {
            const [images, setImages] = useState([]);
            const [currentIndex, setCurrentIndex] = useState(null);
            const [preset, setPreset] = useState('10x15');
            const [orientation, setOrientation] = useState('portrait');
            const [customW, setCustomW] = useState(10);
            const [customH, setCustomH] = useState(10);
            const [isDragging, setIsDragging] = useState(false);
            const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
            const [isDownloading, setIsDownloading] = useState(false);

            const canvasRef = useRef(null);
            const containerRef = useRef(null);
            
            const DPI = 300;
            const INCH_TO_CM = 2.54;

            const targetDim = useMemo(() => {
                let w, h;
                if (preset === '10x15') { w = 10; h = 15; }
                else if (preset === '13x18') { w = 13; h = 18; }
                else { w = parseFloat(customW) || 10; h = parseFloat(customH) || 10; }
                return orientation === 'landscape' ? { w: h, h: w } : { w, h };
            }, [preset, orientation, customW, customH]);

            const handleFile = (e) => {
                const files = Array.from(e.target.files);
                const newImgs = files.map(file => ({
                    file,
                    url: URL.createObjectURL(file),
                    name: file.name,
                    x: 0, y: 0, zoom: 1
                }));
                setImages(prev => [...prev, ...newImgs]);
                if (currentIndex === null) setCurrentIndex(0);
            };

            const draw = useCallback(() => {
                const canvas = canvasRef.current;
                if (!canvas || currentIndex === null || !images[currentIndex]) return;
                const ctx = canvas.getContext('2d');
                const imgData = images[currentIndex];
                const img = new Image();
                img.src = imgData.url;

                img.onload = () => {
                    const container = containerRef.current;
                    const containerSize = Math.min(container.clientWidth, container.clientHeight) * 0.9;
                    canvas.width = container.clientWidth;
                    canvas.height = container.clientHeight;
                    ctx.clearRect(0, 0, canvas.width, canvas.height);

                    const maxDim = Math.max(targetDim.w, targetDim.h);
                    const maskDisplayW = (targetDim.w / maxDim) * containerSize;
                    const maskDisplayH = (targetDim.h / maxDim) * containerSize;

                    const baseScale = Math.max(maskDisplayW / img.width, maskDisplayH / img.height);
                    const finalScale = baseScale * imgData.zoom;

                    const w = img.width * finalScale;
                    const h = img.height * finalScale;
                    const x = (canvas.width / 2) + imgData.x - (w / 2);
                    const y = (canvas.height / 2) + imgData.y - (h / 2);

                    ctx.drawImage(img, x, y, w, h);
                };
            }, [images, currentIndex, targetDim]);

            useEffect(() => { draw(); }, [draw]);

            const onMove = (e) => {
                if (!isDragging || currentIndex === null) return;
                const dx = e.clientX - dragStart.x;
                const dy = e.clientY - dragStart.y;
                setImages(prev => {
                    const next = [...prev];
                    next[currentIndex] = { 
                        ...next[currentIndex], 
                        x: next[currentIndex].x + dx, 
                        y: next[currentIndex].y + dy 
                    };
                    return next;
                });
                setDragStart({ x: e.clientX, y: e.clientY });
            };

            const download = () => {
                if (currentIndex === null || isDownloading) return;
                setIsDownloading(true);
                
                const imgData = images[currentIndex];
                const img = new Image();
                img.src = imgData.url;

                img.onload = () => {
                    const exportCanvas = document.createElement('canvas');
                    const pxW = Math.round((targetDim.w / INCH_TO_CM) * DPI);
                    const pxH = Math.round((targetDim.h / INCH_TO_CM) * DPI);
                    
                    exportCanvas.width = pxW;
                    exportCanvas.height = pxH;
                    const ctx = exportCanvas.getContext('2d');

                    const container = containerRef.current;
                    const containerSize = Math.min(container.clientWidth, container.clientHeight) * 0.9;
                    const maxDim = Math.max(targetDim.w, targetDim.h);
                    const maskDisplayW = (targetDim.w / maxDim) * containerSize;
                    const ratio = pxW / maskDisplayW;

                    const baseScale = Math.max(maskDisplayW / img.width, (targetDim.h / maxDim * containerSize) / img.height);
                    const finalScale = baseScale * imgData.zoom * ratio;

                    const w = img.width * finalScale;
                    const h = img.height * finalScale;
                    const x = (pxW / 2) + (imgData.x * ratio) - (w / 2);
                    const y = (pxH / 2) + (imgData.y * ratio) - (h / 2);

                    ctx.fillStyle = "white";
                    ctx.fillRect(0,0, pxW, pxH);
                    ctx.drawImage(img, x, y, w, h);

                    // Blob-based download is more reliable than DataURL
                    exportCanvas.toBlob((blob) => {
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `crop_${targetDim.w}x${targetDim.h}cm.jpg`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                        setIsDownloading(false);
                    }, 'image/jpeg', 0.95);
                };
            };

            return (
                <div className="flex h-screen w-screen overflow-hidden">
                    <aside className="w-80 bg-white border-r p-6 flex flex-col gap-6 overflow-y-auto shadow-xl z-20">
                        <div>
                            <h1 className="text-xl font-bold text-slate-900">Photo Cropper <span className="text-blue-600">v4</span></h1>
                            <p className="text-xs text-gray-500">Fixed Download & Orientation</p>
                        </div>

                        <div className="space-y-4">
                            <label className="block text-sm font-bold text-slate-700">1. Target Print Size</label>
                            <select className="w-full p-2 border border-slate-300 rounded-md bg-slate-50" value={preset} onChange={e => setPreset(e.target.value)}>
                                <option value="10x15">10 x 15 cm (Standard)</option>
                                <option value="13x18">13 x 18 cm (Large)</option>
                                <option value="custom">Custom Size</option>
                            </select>
                            
                            <div className="flex gap-1 bg-slate-100 p-1 rounded-md">
                                <button onClick={() => setOrientation('portrait')} className={`flex-1 py-1.5 text-xs font-semibold rounded ${orientation === 'portrait' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}>Portrait</button>
                                <button onClick={() => setOrientation('landscape')} className={`flex-1 py-1.5 text-xs font-semibold rounded ${orientation === 'landscape' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}>Landscape</button>
                            </div>

                            {preset === 'custom' && (
                                <div className="grid grid-cols-2 gap-2">
                                    <input type="number" value={customW} onChange={e => setCustomW(e.target.value)} className="p-2 border rounded text-sm" placeholder="Width (cm)"/>
                                    <input type="number" value={customH} onChange={e => setCustomH(e.target.value)} className="p-2 border rounded text-sm" placeholder="Height (cm)"/>
                                </div>
                            )}
                        </div>

                        <div className="border-t pt-4">
                            <label className="block text-sm font-bold text-slate-700 mb-2">2. Manage Batch</label>
                            <input type="file" multiple accept="image/*" onChange={handleFile} className="hidden" id="fup"/>
                            <label htmlFor="fup" className="block w-full py-2 bg-slate-800 text-white text-center rounded-md font-medium cursor-pointer hover:bg-black transition">
                                Upload Images
                            </label>
                            <div className="mt-4 space-y-1 max-h-48 overflow-y-auto">
                                {images.map((img, i) => (
                                    <button key={i} onClick={() => setCurrentIndex(i)} className={`w-full text-left p-2 text-xs truncate rounded-md transition ${currentIndex === i ? 'bg-blue-50 border-blue-200 border text-blue-700' : 'hover:bg-slate-50 text-slate-600 border border-transparent'}`}>
                                        {i+1}. {img.name}
                                    </button>
                                ))}
                                {images.length === 0 && <p className="text-center text-gray-400 text-xs py-4 italic">No images loaded</p>}
                            </div>
                        </div>

                        {currentIndex !== null && (
                            <div className="mt-auto border-t pt-4 space-y-4">
                                <div>
                                    <div className="flex justify-between mb-1">
                                        <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Crop Zoom</label>
                                        <span className="text-xs font-mono text-blue-600">{Math.round(images[currentIndex].zoom * 100)}%</span>
                                    </div>
                                    <input type="range" min="0.1" max="5" step="0.01" value={images[currentIndex].zoom} 
                                        onChange={e => {
                                            const v = parseFloat(e.target.value);
                                            setImages(prev => {
                                                const n = [...prev]; n[currentIndex].zoom = v; return n;
                                            });
                                        }} className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                                </div>
                                <button 
                                    onClick={download} 
                                    disabled={isDownloading}
                                    className={`w-full py-3 rounded-lg font-bold shadow-lg transition transform active:scale-95 ${isDownloading ? 'bg-slate-400' : 'bg-green-600 hover:bg-green-700 text-white'}`}
                                >
                                    {isDownloading ? 'Generating...' : `Download ${targetDim.w}x${targetDim.h}cm Crop`}
                                </button>
                            </div>
                        )}
                    </aside>

                    <main className="flex-1 flex items-center justify-center p-4 bg-slate-200 relative">
                        <div 
                            ref={containerRef}
                            className="viewport-container"
                            onMouseDown={e => { setIsDragging(true); setDragStart({ x: e.clientX, y: e.clientY }); }}
                            onMouseMove={onMove}
                            onMouseUp={() => setIsDragging(false)}
                            onMouseLeave={() => setIsDragging(false)}
                        >
                            {currentIndex !== null ? (
                                <>
                                    <canvas ref={canvasRef} />
                                    <div className="mask-frame" style={{
                                        width: `${(targetDim.w / Math.max(targetDim.w, targetDim.h)) * (Math.min(containerRef.current?.clientWidth || 0, containerRef.current?.clientHeight || 0) * 0.9)}px`,
                                        height: `${(targetDim.h / Math.max(targetDim.w, targetDim.h)) * (Math.min(containerRef.current?.clientWidth || 0, containerRef.current?.clientHeight || 0) * 0.9)}px`
                                    }} />
                                </>
                            ) : (
                                <div className="text-center">
                                    <div className="mb-2 text-slate-400">
                                        <svg className="w-12 h-12 mx-auto mb-2 opacity-20" fill="currentColor" viewBox="0 0 20 20"><path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"/></svg>
                                        <p className="text-lg font-medium">No Image Selected</p>
                                        <p className="text-sm">Upload and select a photo from the sidebar</p>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="absolute bottom-4 right-4 bg-white/80 backdrop-blur px-3 py-1 rounded text-[10px] font-mono text-slate-500 uppercase">
                            Preview Only • Export will be 300 DPI Borderless
                        </div>
                    </main>
                </div>
            );
        };

        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<App />);
    </script>
</body>
</html>
```

### `README.md`
```markdown
The Simple Photo Cropper app is a simple app to size the photo to a set canvas size when you are printing photos in a specific size
```
