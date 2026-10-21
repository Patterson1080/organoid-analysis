# Routing overview: cables as curves — design

**Date:** 2026-10-21 · **Branch:** `routing-cables` · **Builds on:** `2026-10-21-routing-round2-design.md`

## The ask

On the overview, make the signal cables curves and make sure they're visible. Before this, the cable from the organoid to a card (for example, to the Visual card) was thin and stopped at the card's nearest corner, so it was hard to see. The arm-to-audio loop stays as it is. The other cables should use the space as curves. After that: a design review, a code review, fixes for anything major, a deslop pass, and a merge to `origin/main`.

## Decisions (mine, no questions asked)

- **A channel:** the cards sit `max(g, 0.28 r)` from the organoid instead of `g`. Without it the LED card faces the rim across about 15 px.
- **Cables:**
  - each is a cubic Bézier from just outside the rim (`r + 3`) to the middle of the card edge that faces the organoid;
  - it leaves the rim radially and arrives square to the edge, with handles 0.5 × the start-to-end distance;
  - the start point is spread round the rim, toward the open space beside the cards, by `0.6 × |off-axis|`. That space is above and below the organoid in landscape, and left and right of it in portrait;
  - the geometry lives in `cables.ts`, and `routingLayout` computes it once per size.
- **Look:**
  - every cable has a soft halo (a 7 px white line at alpha 0.05–0.14) so it reads on black;
  - each starts at a jack on the rim and ends in an arrowhead into its card;
  - `/index` streams are drawn in `#8c8c8c`, with white dashes that flow only while the index advances;
  - the LED serial link is solid `#707070`, with a dot that travels along it on each frame;
  - the link to the artifacts is dotted `#5c5c5c`, with no halo, because they were made before the show;
  - hovering a card lights its cable.
- **Max → solenoids:** a short lead from the lower part of the sound card's facing edge to the upper part of the solenoid card's, bowing out into the channel. It brightens with the strikes.
- **Tags:** each sits beside its cable, never on it, and clear of the cards and of the other tags. If there's no room it falls back to just inside the rim.
- **Portrait:** the "AUDIO COMPUTER · Max/MSP" label moves to the frame's top right, out of the cables' way.

## Design review fixes (major only)

- **Contrast:** text greys below 4.5:1 on black are raised to `#777`; the attribution goes to `#888`.
- **Cards:** the text area is sized from its wrapped rows, and a LIVE / SIMULATED / ≈ badge always stays in view (`linesKeepLast`, which drops whole lines).
- **Visual card:** the swarm labels drop their counts when a cell is narrow.
- **Attribution:** it splits by the circle's width at that height, on a black ground.
- **Text:**
  - a word wider than its box hard-breaks;
  - titles fit with an ellipsis;
  - chain cells grow to fit their wrapped values.
- **Robot detail:** the visitor bars leave room for their captions and the attribution, and the side text keeps its badge.
- **Accessibility:** the canvas gets `role="img"` and a label, and `.btn` gets a visible focus ring.

## The team's answers (this round)

| Question | Answer | What changes |
|---|---|---|
| Which arm firmware | most likely the rebuild (shown three times since CURRENTS) | the copy leads with the rebuild; the CURRENTS sketch's `proximitydata:` the Max patch doesn't route |
| `+ 1` in termiteKick | yes; then, since Diarmid manages the Max patches: keep his patches as they are, they're the ground truth | no change; the view shows the patch as wired (half the kicks silent, the rest on speakers 3–4). The round-2 `metro 4800` / `metro 9600` edit to the local copy is undone for the same reason |
| Kick density fallback | either is fine | stays on the paper's mapping |
| Merge to `origin/main` | after the feedback | merged and pushed |
