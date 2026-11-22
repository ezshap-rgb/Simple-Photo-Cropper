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
