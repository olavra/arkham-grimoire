# Arkham Grimoire

A single-page card browser for **Arkham Horror: The Card Game**, built on the public
[ArkhamDB API](https://arkhamdb.com/api/). No build step, no dependencies — plain HTML,
CSS and ES5-compatible JavaScript.

Theme adapted from [templatemo 624 "Lustro Slideshow"](https://templatemo.com/live/templatemo_624_lustro_slideshow).

## Running it

The app talks to `arkhamdb.com` over CORS, so serve it over HTTP rather than opening
`index.html` from disk:

```
python -m http.server 8777
```

Then visit <http://127.0.0.1:8777/>.

## Structure

```
index.html            app shell — top bar, breadcrumb, view container
css/style.css         Lustro-derived design system (tokens, glass surfaces, grids)
css/arkham-icons.css  @font-face + the .icon-* / .color-* classes
js/api.js             ArkhamDB client + in-memory cache
js/markup.js          renders [action]/[willpower]/… tokens and FFG's HTML subset
js/cardback.js        picks the printed card back for cards with no defined reverse
js/viewer.js          3D card preview overlay
js/app.js             hash router and the three views
fonts/                arkham-icons.{woff,ttf,otf}
img/                  player.png / encounter.png — the two generic card backs
img/icons/            every icon glyph as a standalone SVG, plus health/sanity
img/factions/         ArkhamDB's 16px class plates (reference)
docs/icons.md         the icon index
docs/regen-icons.py   re-pulls the icon assets from ArkhamDB
```

## Filtering a pack

Above the grid sit two rows of toggles, **Type** and **Faction**. They are built from the
cards the open pack actually contains, so a campaign expansion never offers an
`investigator` toggle it can't fill, and each one carries its share of the pack.

- Toggles combine as **OR within a row, AND across rows**: `Asset` + `Event` + `Guardian`
  means "guardian assets and guardian events".
- **Nothing selected in a row means that row filters nothing** — all types, all factions.
- The text box ANDs on top of both rows.
- **Clear filters** appears once anything is on. The counts on each toggle are for the
  whole pack, not the current selection, so they stay put while you click around.

Selections are remembered per pack, so opening a card and coming back leaves the grid as
you left it. They are deliberately not in the URL — a shared link points at a pack, not at
someone else's filter state.

### Going back to a grid

Returning to a list restores the exact scroll position, in one jump. Two things have to
hold for that, and both are easy to undo by accident:

- A rebuilt grid only holds the first batch of 60, so the document is much shorter than it
  was. The batch count is stored alongside the scroll offset and replayed first — without
  that, the jump lands short and the observer then walks down the list in visible steps.
- `scroll-behavior: smooth` on `html` turns the restore into an animation from the top.
  It is off, and `restoreScroll` pins it to `auto` for the jump regardless.

## 3D card preview

Clicking the art on a card page opens it in an overlay: the background blurs, the card sits
centre screen as a real 3D object with thickness, and you can

| Input | Action |
| --- | --- |
| Drag | Rotate on both axes (with a little momentum on release) |
| Scroll / pinch | Zoom, 0.35× to 5× |
| `F` or **Flip** | Turn to the other face |
| `R` or **Reset** | Back to square on at 1× |
| Arrow keys | Nudge the rotation 10° at a time |
| Double click | Reset |
| `Esc`, ✕, or click outside | Close |

It is built on CSS 3D transforms: two coplanar image faces inside a `preserve-3d` stage,
with `backface-visibility` deciding which one you see. The card is a zero-thickness sheet —
no edge quads — so nothing shows along the rim when it turns edge-on.

Two things that will quietly break it:

- A `filter` anywhere on the card element flattens the `preserve-3d` context and disables
  `backface-visibility`, which renders a mirrored front instead of the back. The drop shadow
  lives on the faces for that reason.
- The card art has square corners, so both faces carry their own `border-radius`. It is
  derived from `--w` (written by the viewer on open and on resize) rather than hard-coded,
  so it stays proportional for portrait and landscape cards alike.

### Card backs

ArkhamDB only ships a `backimagesrc` for genuinely double-sided cards (investigators, acts,
agendas, some locations). Everything else falls back to the printed back for its deck,
chosen in `cardback.js`:

- **`img/encounter.png`** — anything with an `encounter_code`, or a `mythos` faction card.
- **`img/player.png`** — everything else, weaknesses included, since those shuffle into a
  player deck and share its reverse.

The subtitle in the overlay says when a generic back is in use.

## Routes

| Route             | View                                                      |
| ----------------- | --------------------------------------------------------- |
| `#/`              | Hero + every pack, grouped by cycle, with an **All Cards** entry |
| `#/pack/{code}`   | Card grid for one pack — image, name, faction accent      |
| `#/pack/_all`     | The complete pool (player + encounter cards), no pack filter |
| `#/card/{code}`   | Full card data: stats, text, flavor, reverse side, metadata |

## Notes on the API

- `GET /api/public/packs/` — 114 packs. Cycle grouping is derived from `cycle_position`
  on each pack, because `GET /api/public/cycles/` currently returns HTTP 500.
- `GET /api/public/cards/{pack}` — cards for one pack.
- `GET /api/public/cards/?encounter=1` — the full 5,929-card pool (~9 MB). That is well past
  the `sessionStorage` quota, so caching is in-memory only and the grid renders in batches
  of 60 as you scroll.
- `GET /api/public/card/{code}` — a single card, used when you deep-link straight to one.

Card images are served from `https://arkhamdb.com` + the card's `imagesrc`.

## Icons

The real Arkham symbols, from ArkhamDB's own `arkham-icons` font, vendored under `fonts/`.
`[reaction]`, `[willpower]`, `[skull]`, `[per_investigator]` and the rest render as glyphs
via the `.icon-*` classes in `css/arkham-icons.css`, which mirror ArkhamDB's naming. Class
symbols (guardian/seeker/rogue/mystic/survivor) come from the same font. Tokens with no
glyph — `[mythos]`, `[neutral]` and anything a future set introduces — degrade to a readable
tag rather than leaking raw `[brackets]` into the text.

Every glyph is also extracted to a standalone SVG in `img/icons/`. **[docs/icons.md](docs/icons.md)
is the full index** — name, character, class, and where each icon is used. Run
`python docs/regen-icons.py` to re-pull everything from ArkhamDB.

## Not in this version

Deck building, per the project brief. Sorting and faceted filters beyond the text filter
are also out of scope for v1.

Card data and images are © Fantasy Flight Games, served by ArkhamDB.
