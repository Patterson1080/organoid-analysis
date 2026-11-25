# Design rules

Shared by organoid-analysis and Kybyria. The values are in `tokens.css` (`docs/design/tokens.css` here, `src/design/tokens.css` in Kybyria). This page holds the rules that values alone cannot express. organoid-analysis is the source of truth; Kybyria keeps a copy of both files.

## Look

- **Black and monochrome.** Background near black, text white, secondary text grey, 1 px lines.
- **Colour is reserved for data.** Interface elements never use a hue. Signal strength is white at varying opacity.
- **It is part of the work, not a dashboard.** No cards with shadows, no gradients, no rounded panels, no icons where a word will do.
- **Precise small type.** Labels are monospace, uppercase and letter-spaced. Body text is the sans face. Nothing is drawn below 8 px.
- **Type and strokes scale with the area** they are drawn in, so one layout works on any screen shape.

## Legibility

- A first-time viewer who watches for a minute can point at an element and say what drives it.
- Every value states how sure it is: exact, ≈ computed, SIMULATED, or LIVE.
- Each element carries a title, one line of description, and at most four lines of detail.
- Nothing on screen misstates the wiring. If a route is off, it is drawn as off.
- Nothing depends on hover; every action works by tap.

## Lines

| Line | Meaning |
|---|---|
| Solid | A running path |
| Moving dashes | A path the signal is flowing along now; the dashes stop when the signal stops |
| Dotted | An asynchronous path: something made before the show |
| Dashed | A planned, dormant or return path |

Animation shows timing, not individual messages. A pulse is drawn only for the event it stands for.

## States

- **Off:** everything dims to about 30 %, and nothing pulses.
- **Stopped or paused:** the last state is held.
- **Missing input:** only the affected element degrades, and it says what is missing.

## Node graphs (Kybyria)

These extend the rules above to the node system. They are a proposal until confirmed.

- Flow runs left to right: sources on the left, media on the right, return paths curving back underneath.
- A node is a plain 1 px box holding its kind as an uppercase label, its name, and one line of description.
- Medium nodes show their role, never a hardware count.
- In Conducta the graph cannot be edited and paths animate. In Composita paths are still and every node shows its edit handles.
- The mode is always visible, and the two modes must be distinguishable at a glance without colour.
