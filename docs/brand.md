# AgriTech brand identity

The brand lives in one place: `components/agritech-mark.tsx`. Do not hand-draw
logo shapes elsewhere; import the components instead.

**Decision: the monochrome single-ink mark is the standard logo** used across
the entire interface (all navigation, login, print contexts). The color badge
is retained only for the browser favicon / app-icon context.

## Concept

**"The plant as a monitored node."** A single botanical leaf outline, with thin
data traces connecting at its stem and ending in small telemetry nodes. It
reads as three ideas at once:

- **Agriculture** — the leaf (botanical, tilted upward: growth).
- **Intelligence** — the traces + node network (sensors, data flow, AI).
- **Monitoring** — the ringed terminal node (a live signal being observed).

Concept words: professional · innovative · trustworthy · sustainable ·
intelligent. Deliberately avoided: soil lines, barns, tiny cartoon plants, or
any generic gardening clipart.

## Palette

| Role | Color | Hex |
| --- | --- | --- |
| Brand ink (mono mark + wordmark) | Deep forest ink | `#244b34` (light surfaces), `#ffffff` (dark surfaces) |
| App-icon badge (favicon only) | Deep forest gradient | `#255238 → #152e20` |
| Botanical green (app icon only) | Leaf gradient | `#4e8a52 → #74b166 → #a9d688` |
| Node / track accent (app icon only) | Off-white mint | `#d7ead3`, `#b7d9c0` |

The application UI stays inside its existing green system — the ink `#244b34`
is the same deep green already used for headings and links.

## Variations

1. **Primary lockup** — `<AgritechLogo />`: mono mark + "AgriTech" wordmark in
   one matching ink (`#244b34` on light, white on dark via `variant="inverse"`).
   No two-tone text: the whole lockup is a single ink. Used in all navigation
   headers (landing, login, register, dashboard, admin, tool pages). The
   wordmark is real text — accessible, selectable, no extra fonts.
2. **Standalone icon** — `<AgritechMark variant="mono" />` (the default). The
   leaf-and-network glyph is recognizable without text; used in tight spaces
   and mobile headers (where `AgritechLogo`'s `responsive` prop hides the
   wordmark below `sm`).
3. **Compact version** — the same components scale losslessly (pure SVG).
   Printed QR labels use the mono mark at 24–30 px with a small text wordmark.
4. **Monochrome** — this IS the primary rendition. Single ink via
   `currentColor`: set the color on the wrapper (`text-[#244b34]`, white, or
   any ink) and mark + wordmark follow. `variant="inverse"` is fixed white.
   `variant="color"` is the deep-forest badge used only by `app/icon.svg`
   (browser favicon / launcher icon — a filled badge stays visible on any
   browser/OS theme).

## Usage rules

- Never redraw, recolor, or rotate the mark; never stretch it (`size` keeps it
  square).
- Single ink only: never mix inks inside the mark (all strokes, veins and
  nodes share one color).
- Minimum sizes: mono mark 20 px in the UI, 24–30 px in print.
- Keep clear space around the mark of ≥ 25% of its width; the lockups use a
  `gap-2.5/3` column between mark and wordmark.
- `aria-label="AgriTech"` on the icon SVG; the wordmark is real text — combined
  they name the brand for screen readers. Translations are disabled via
  `translate="no"` on the lockup.
- Contrast: ink `#244b34` on light surfaces ≥ 9.8:1; white on dark ≥ 9.8:1
  (WCAG AAA).

## Favicon / app icon

`app/icon.svg` keeps the filled badge rendition (the only color context),
mirroring the same geometry one-to-one. Next.js serves it automatically at
`/icon.svg`; the auth middleware allows it (and `/favicon.ico`) through so
unauthenticated browsers can load it.

## Visual reference

Load `docs/assets/brand-preview.html` in a browser (also opened in the Review
pane during the redesign): primary mono lockups on light/dark, standalone
sizes, the mono print rendition, and the app-icon badge for comparison.
