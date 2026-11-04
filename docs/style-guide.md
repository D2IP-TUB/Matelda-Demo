# Matelda style guide

Derived from the landing page (`frontend/src/pages/Landing.tsx`, `styles/pages/landing.css`).
The tokens live in `frontend/src/styles/tokens.css`; components use the semantic tokens only, never raw hex.

## Character
An ink-black stage with one electric-blue accent. A blue → violet → pink gradient is the brand's only flourish,
used sparingly (the logotype, one headline phrase). Surfaces are quiet, rounded and softly lit; motion is springy
but short. **Dark is the landing's own palette. Light is its daylight twin**: same hues, deepened for contrast on paper.

The theme follows the system. The toggle in the top bar sets `data-theme="light|dark"` on `<html>` (stored as
`matelda-theme`). The landing page itself is always dark: it is the stage.

## Type
| Role | Spec |
|---|---|
| Family | System UI stack: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', Inter, 'Segoe UI', Roboto, system-ui, sans-serif`. Mono: `ui-monospace, 'SF Mono', Menlo, Consolas`. No webfont download. |
| Scale | caption 12 · footnote 13 · body 16 · callout 17 · title3 20 · title2 24 · title1 32 · display `clamp(2rem, 4vw+1rem, 3rem)`; hero up to 4rem |
| Weights | 800 wordmark and hero, 700 headings, 600 labels and buttons, 500 chips, 400 body |
| Tracking | −0.022em on headings (−0.03em on the hero); default on body |
| Numbers | `tabular-nums` for tables, counters and timers |
| Line height | 1.15 headings, 1.5 body |

## Colour
| Token | Dark (landing) | Light (derived) | Use |
|---|---|---|---|
| `--bg` | `#07080d` | `#f4f5fa` | page |
| `--surface` | `#12141d` | `#ffffff` | cards, dialogs |
| `--surface-2` | `#1a1d29` | `#eceef6` | wells, table headers |
| `--label` | `#f5f5f7` | `#0b0d16` | primary text |
| `--label-2` | `#a9adbd` | `#565b70` | secondary text |
| `--label-3` | `#6b7085` | `#8a8fa3` | decorative / disabled only |
| `--separator` | white 10% | ink 12% | hairlines |
| `--accent` | `#3b99ff` | `#1a62c9` | links, focus, selected |
| `--accent-fill` | `#0b72e0` | `#1a62c9` | primary button fill (white text) |
| `--good` / `--bad` / `--warn` | `#30d158` / `#ff6b61` / `#ffb340` | `#1a7f37` / `#c9231a` / `#8a5a00` | verdicts and notices; always with an icon or word |
| `--brand-gradient` | `#6cb6ff → #c084fc → #ff7ab8` | `#2f7fe6 → #8e44d8 → #d6336c` | logotype, one hero phrase |

Contrast (measured): all text pairs ≥ 4.5:1 in both themes (label-2 on surface 8.2 dark / 6.7 light; accent on surface
6.3 dark / 5.8 light; white on the button fill 4.7 / 5.8). `--label-3` is never used for text that carries meaning.

## Shape, space, depth, motion
- Radii: 8 · 12 · 18 · 24 · pill. Cards 18–24, buttons and chips pill.
- Spacing: 4pt scale (`--s-1` … `--s-7`: 4 8 12 16 24 32 48). Hit targets ≥ 44px on touch.
- Depth: three shadows (`--shadow-1/2/3`); in dark they are hairline rings plus a deep drop.
- Material: translucent bar with blur (`--material`). Scrim behind dialogs (`--scrim`).
- Motion: 120 / 220 / 380 ms; `--ease-out` for arrivals, `--ease-spring` for presses and pops. Text enters with a
  staggered 160 ms fade-up. Everything stops under `prefers-reduced-motion`.

## Components
- **Primary button**: `--accent-fill`, white text, pill, one per screen. Ghost: `--fill` with `--accent` text.
- **Cards and dialogs**: `--surface`, `--r-lg`, `--shadow-2`. Dialogs sit on `--scrim`.
- **Chips and pills**: `--fill` background, `--r-pill`, 500 weight. Detector pills on swipe cards follow the same.
- **Verdicts**: correct = `--good` + ✓, error = `--bad` + ✗; the stamp on swipe cards repeats the word.
- **Loading**: one `Loading` component (spinner + label). **Info**: the round **i** button with a popover.
- **Focus**: 3px `--accent-ring` outline, never removed.
