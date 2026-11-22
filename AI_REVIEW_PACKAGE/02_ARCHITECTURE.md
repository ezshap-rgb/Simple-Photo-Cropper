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
