# Nano Banana Pro — SVG asset prompts for StudyApp

These prompts generate every graphic the hexagon-beehive path and the navigation
need. Generate in **batches** (image models handle ~3–8 items per run better than
one giant grid). Paste the **Style guide** block at the top of *every* prompt so
the set stays visually consistent, then paste one asset block.

When the files come back, drop them in `assets/icons/` using the exact filenames
listed. I'll wire them once you add the SVG library (`react-native-svg`).

> Note on format: ask for **SVG, vector, flat, transparent background**. If the
> tool returns raster, ask for **PNG, 1024×1024, transparent background** instead —
> I can use either.

---

## STYLE GUIDE (paste at the top of every prompt)

```
Style: Duolingo-inspired mobile game UI icon. Flat vector, bold and chunky, soft
rounded corners, thick clean outlines, bright saturated fills, simple 2-tone
shading. Each shape has a subtle "3D" lip: a slightly darker band along the BOTTOM
edge to look like a pressable game button. No gradients-as-noise, no photoreal, no
text. Transparent background. Centered, generous padding. Output as SVG (vector),
or transparent PNG 1024×1024 if SVG is unavailable. Consistent line weight across
the whole set. Color palette: green #58CC02 (dark edge #46A302), blue #1CB0F6
(#1899D6), purple #CE82FF (#A568CC), orange #FF9600 (#E08600), red #FF4B4B
(#E63946), teal #2EC4B6 (#21A195), gold #FFC800 (#E6A700), dark canvas #131F24,
white #FFFFFF. Designed to sit on a DARK charcoal (#131F24) app background.
```

---

## BATCH 1 — Hexagon lesson tiles (the beehive)

```
Generate a set of FLAT-TOP hexagon game tiles, each as its own file. Each hexagon
is a big, chunky 3D "button": a flat colored top face with a thicker darker rim
along the bottom edge (same hue, the dark-edge color), giving a beveled, pressable
look like a Duolingo lesson node. Slight inner highlight at the top. Empty center
(no icon) so an icon can be layered on top. Square canvas, hexagon centered with
padding so the bottom rim isn't clipped.

Produce these files:
- hex_green.svg   — top #58CC02, bottom rim #46A302
- hex_blue.svg    — top #1CB0F6, bottom rim #1899D6
- hex_purple.svg  — top #CE82FF, bottom rim #A568CC
- hex_orange.svg  — top #FF9600, bottom rim #E08600
- hex_red.svg     — top #FF4B4B, bottom rim #E63946
- hex_teal.svg    — top #2EC4B6, bottom rim #21A195
- hex_locked.svg  — top #37464F, bottom rim #293841 (a dim, "locked" grey-blue)
```

## BATCH 2 — State icons (white, layered on the hexagons)

```
Generate simple, bold, WHITE (#FFFFFF) game icons, each its own file, centered,
thick rounded strokes, no background. They will be layered on top of the colored
hexagons, so pure white only.

- icon_star.svg     — a chunky 5-point star (an available lesson)
- icon_check.svg    — a bold rounded checkmark (a completed lesson)
- icon_trophy.svg   — a simple trophy cup (a topic quiz / review)
- icon_lock.svg     — a closed padlock (a locked lesson)
- icon_play.svg     — a rounded play/▶ triangle (start / current lesson)
- icon_crown.svg    — a small crown (mastered / perfect score)
```

## BATCH 3 — Bottom navigation icons (colorful, filled)

```
Generate colorful, filled, chunky tab-bar icons, each its own file, centered with
padding, the signature darker-bottom-edge 3D lip. Bright and readable on a dark
background. No text.

- nav_home.svg     — a cozy house / birdhouse, green #58CC02
- nav_chat.svg     — a rounded speech bubble with a small spark/AI glint, blue #1CB0F6
- nav_more.svg     — a rounded squircle holding three horizontal dots "•••", purple #CE82FF
- nav_practice.svg — a dumbbell / barbell, gold #FFC800   (spare, in case we add a Practice tab)
- nav_trophy.svg   — a shield-style leaderboard trophy, bronze #CD7F32   (spare)
```

## BATCH 4 — Top stat-bar + course icons

```
Generate small colorful HUD icons for a game top-bar, each its own file, bold and
filled, centered, transparent background.

- stat_streak.svg   — a flame, orange #FF9600 with a yellow #FFC800 inner flame
- stat_xp.svg       — a lightning bolt OR a faceted gem, gold #FFC800
- stat_goal.svg     — a target/bullseye OR a small treasure chest, green #58CC02
- top_courses.svg   — a stack of books or a flag (the "switch classroom" button), blue #1CB0F6
```

## BATCH 5 — Decorative path props (beehive scenery)

```
Generate chunky decorative game props for a learning map, each its own file, the
same 3D-lip flat style, transparent background.

- prop_chest.svg   — a closed treasure chest, gold/brown with #FFC800 trim
- prop_door.svg    — an arched magic doorway with sparkles, purple #CE82FF (an "AI foundation" milestone)
- prop_mascot.svg  — a friendly cute owl mascot, front-facing, expressive eyes, green + cream
- prop_flag.svg    — a small checkpoint flag on a pole, red #FF4B4B
```

---

## How I'll use them

- `hex_*.svg` + `icon_*.svg` → each lesson tile renders as `hex_<unitColor>` with the
  matching state icon (`lock` / `play` / `star` / `check` / `trophy`) layered on top,
  arranged in an offset honeycomb grid.
- `nav_*.svg` → bottom tab bar (replaces the current Ionicons), keeping the active
  cyan outline box.
- `stat_*.svg` + `top_courses.svg` → the top stats bar and the course-switcher button.
- `prop_*.svg` → scattered along the beehive as non-interactive scenery.

Send them over (plus confirm `react-native-svg` is installed) and I'll wire the
whole hexagon path.
