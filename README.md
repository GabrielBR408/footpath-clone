# Footpath Clone — Snap-to-Path Route Planner

A self-contained, fully-customizable web clone of [Footpath](https://footpathapp.com)'s
core experience: **draw a rough line on the map and it snaps to real trails, roads,
and paths**, with live distance, an interactive elevation profile, and GPX
import/export.

Built on a 100% open, no-API-key stack:

| Piece | Component | Cost / key |
|---|---|---|
| Map UI | [Leaflet](https://leafletjs.com) 1.9 (CDN) | free, no key |
| Base tiles | OpenStreetMap standard tiles | free, no key |
| Snap-to-path routing | [FOSSGIS OSRM](https://routing.openstreetmap.de) public servers (foot + bike) | free, no key |
| Alt routing engine | [BRouter](https://brouter.de) public server (better trail fidelity) | free, no key |
| Elevation | [Open-Meteo elevation API](https://open-meteo.com/en/docs/elevation-api) (90m Copernicus DEM) | free, no key |
| Place search | Nominatim (OSM geocoder) | free, no key |

No build step, no framework, no node_modules — three files of plain HTML/CSS/JS.

---

## Run it

Any static file server works. From this folder:

```powershell
npx http-server . -p 5178
# then open http://localhost:5178
```

(or `python -m http.server 5178`, or VS Code Live Server — anything.)

> Don't open `index.html` directly as a `file://` URL — some of the routing/
> elevation APIs reject requests from a null origin. Use a local server.

## Use it

- **Click** the map → adds a point; the route between points snaps to real paths.
- **✏️ Draw** (or press `D`) → drag a rough freehand line; it's thinned into
  via-points and snapped to the path network — the signature Footpath gesture.
- **Walk / Hike / Trail Run / Bike / Straight** → routing profile for *new*
  segments (mix profiles within one route; "Straight" = no snapping, like
  Footpath's magnet-off mode). **Trail Run** routes via BRouter's
  trail-preferring `hiking-mountain` profile (per-profile engine override in
  `config.js` → `router.engineByProfile`), so it seeks actual trails/paths
  instead of treating roads equally like OSRM's foot profile does. Its time
  estimate uses the median pace of your imported *trail* runs rather than
  your overall road median.
- **Drag a point** to reshape (adjacent segments re-route). **Right-click a
  point** to delete it (route heals around it).
- **⇄ Out & Back** duplicates the route reversed. **◯ Close Loop** routes from
  the end back to the start.
- **Undo / Redo** — buttons or `Ctrl+Z` / `Ctrl+Y`.
- **⤓ GPX** exports the snapped track (with elevations) for a watch/phone/Gaia/
  Strava. **⤒ GPX** imports an existing track.
- **Hover the elevation chart** → a dot shows that spot on the map.
- **Search box** → jump to any place (Nominatim).
- **🏃 Trails** (or press `T`) → your own imported runs as pickable segments —
  see "My Trails" below.

## My Trails — your own runs as route segments

Import your real activities (e.g. pulled from Strava) and stitch them into
routes, with a **personal time estimate** based on your own pace.

- **User profiles**: the 👤 selector in the toolbar. Each user's trail data is
  stored in **this browser only** (localStorage) — nothing is uploaded,
  committed, or published. Add users with "＋ New user…".
- **Import**: open 🏃 Trails → **⤒ Load my trails (JSON)** → pick your
  `strava-runs.json` from the device (works on phones — get the file onto the
  phone via AirDrop/Drive/Files and pick it). It persists in that browser until
  cleared. Expected schema: `{ runs: [{ id, name, start_date, distance_m,
  moving_time_s, elev_gain_m, pace_s_per_km, latlng: [[lat,lng],…] }, …],
  median_pace_s_per_km }`.
- **Local convenience**: if `strava-runs.json` sits next to `index.html` when
  served locally, it auto-imports on first load. That file is **gitignored** so
  it can never reach the public site.
- **Pick & stitch**: hover a run to preview it; **+ Add** appends it to the
  route (auto-oriented, auto-connected from your route's end with a snapped
  segment). "Show all on map" renders every run faintly — click one to add it.
  Trail segments draw in Strava orange; their anchor points can't be dragged
  (that would break the recorded track) — right-click from the route end to
  remove, or Undo.
- **Est. Time** in the stats bar: trail segments use *that run's real pace*;
  snapped/drawn segments use your *median pace*, plus a light hill adjustment
  (`trails.hillSecondsPerMeterAscent` in config, default 6 s per meter of
  climb, applied to non-trail segments only).

## Customize it

Everything lives in **`config.js`** — one file, commented:

- **Start location / zoom** — `startCenter`, `startZoom`.
- **Units** — `units: 'imperial' | 'metric'`.
- **Map style** — swap the `tiles` object; ready-to-paste alternatives
  (OpenTopoMap, CyclOSM, Esri satellite) are in the comments.
- **Routing engine** — `router.engine: 'osrm' | 'brouter'`. BRouter gives better
  hiking-trail fidelity and returns elevation with the route (skipping the
  elevation API entirely). Endpoints are plain URLs — point them at your own
  server for full control.
- **Profiles** — add/remove/rename profiles in `profiles` (labels + colors),
  and map each to an engine endpoint/profile in `router`.
- **Colors & line weights** — `colors`, `routeStyle`.
- **Draw-mode feel** — `draw.viaPixelGap` (lower = follows your scribble more
  tightly, more routing calls), `draw.maxViaPoints`.
- **Elevation provider** — `elevation.provider`: `openmeteo` (default),
  `openelevation`, or `opentopodata` (self-hosted only — the public
  OpenTopoData API doesn't send CORS headers, so browsers block it).

Styling/layout is `styles.css`; all behavior is `app.js` (~700 commented lines,
no framework — easy to modify).

There's also a small console API for scripting/testing:
`FootpathApp.addPoint(lat, lng)`, `.setProfile('bike')`, `.getDistanceMeters()`,
`.undo()`, `.outAndBack()`, etc.

## Going fully self-hosted (optional)

The public demo servers are fine for personal use but rate-limited and not SLA'd.
For full independence / offline capability:

- **Routing** — run [BRouter](https://github.com/abrensch/brouter) (Java, needs
  ~free RAM, downloads regional `.rd5` segment files) or
  [OSRM](https://github.com/Project-OSRM/osrm-backend) /
  [Valhalla](https://github.com/valhalla/valhalla) in Docker with an OSM extract
  of your region. Then change one URL in `config.js`.
- **Elevation** — run [OpenTopoData](https://github.com/ajnisbet/opentopodata)
  in Docker with SRTM/NED tiles and set `provider: 'opentopodata'`,
  `url: 'http://localhost:5000/v1/srtm30m'`.
- **Tiles** — any raster tile server, or pre-download tiles for your region.

## Known limitations vs. real Footpath

- **No hiking-specific routing profile on the default engine** — OSRM's public
  foot profile routes on trails but doesn't prefer them the way Footpath's hike
  mode does. Switch `router.engine` to `'brouter'` for better trail behavior
  (public BRouter server coverage/profile names vary), or self-host BRouter/
  Valhalla for full fidelity.
- **No saved-route library / accounts / sync** — routes live in the current tab;
  persistence is GPX files. (localStorage save/load would be a ~50-line add.)
- **No offline maps or turn-by-turn navigation** (Footpath Elite features).
- **No eraser / trace-over-to-fix editing** — reshaping is drag-a-point and
  undo, not Footpath's splice-in-a-new-trace gesture.
- **Elevation is 90m DEM** via Open-Meteo — good profiles, but short steep
  pitches can be smoothed vs. Footpath's data.
- **Public server etiquette** — the free OSRM/BRouter/Nominatim servers are
  shared community infrastructure; fine for personal route planning, not for
  heavy traffic. Self-host if usage grows.

See [FOOTPATH-REVIEW.md](FOOTPATH-REVIEW.md) for the full product research this
clone was built from.
