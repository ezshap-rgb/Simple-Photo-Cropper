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
