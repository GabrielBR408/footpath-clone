# Footpath Route Planner — Product Research Review

Research date: 2026-07-03. Purpose: product-research foundation for an open-source clone.
Primary sources: official site/user guide (footpathapp.com), Apple App Store listing, third-party reviews.
Anything not confirmed by a primary source is marked **(unverified)**.

---

## 1. What Footpath Is

**Footpath Route Planner** by **Half Mile Labs LLC** is a freemium route-planning and navigation app
for running, cycling, hiking, walking, and other outdoor activities. Its pitch: "Map routes with your
finger and Footpath will snap to roads and trails," then get distance + elevation instantly
([footpathapp.com](https://footpathapp.com), [App Store](https://apps.apple.com/us/app/footpath-route-planner/id634845718)).

- **Platforms:** iOS (App Store id 634845718), Android (`com.halfmilelabs.footpath` on Google Play),
  Apple Watch (the FAQ calls it "the only tool to navigate custom routes on Apple Watch"), plus iPad
  and a **web version** referenced in the official FAQ ("You can also use it on the Web and iPad, but
  the phone is the best experience") ([FAQ](https://footpathapp.com/support/faq/)).
- **Supported activities (App Store copy):** "running, cycling and mountain biking, hiking and
  mountaineering, walking, motorcycling and driving, backcountry skiing, kayaking and standup
  paddleboarding, sailing, and many more."
- **Business model:** free tier with core planning; **Footpath Elite** subscription unlocks premium
  maps, offline downloads, turn-by-turn navigation, unlimited routes, exports, and more.
- Help documentation lives at `footpathapp.com/user-guide/` and `footpathapp.com/support/faq/`
  (no separate `support.footpathapp.com` host — that domain does not resolve).

## 2. The Signature Interaction: Snap-to-Path Drawing

Documented in the official user guide ([Drawing a route](https://footpathapp.com/user-guide/drawing-a-route/)):

1. **Draw mode:** "Tap the pencil button to enter 'draw' mode," then "trace a path along the map with
   your finger" (or Apple Pencil). The app "automatically snap[s] your route to the closest available
   paths" — roads, bike paths, hiking trails; marketing copy says it can even snap to rivers and railroads.
2. **Point-to-point routing:** long-press the map, "select your activity mode," and Footpath computes
   a route from the current endpoint to that point (auto-routing between distant points, like a
   click-to-route planner).
3. **Snapping toggle:** tap the **magnet button** to "temporarily disable Snap to Map and manually
   trace" straight lines — intended for water/snow/off-trail segments; re-enable afterward.
4. **Route-finishing tools** (tap the start or end point for a menu):
   - **Loop** — "calculate a route directly back to the starting point" (auto loop-closing).
   - **Out & Back** — retrace the drawn route back to the start in reverse.
   - **Reverse** — flip route direction.
   - **Set as Start** — on a saved loop, move the start point to any point on the route
     ([Modifying a route](https://footpathapp.com/user-guide/modifying-a-route/)).
5. **Editing model — trace-over, not point-drag:** to fix a middle section, "use your finger to trace
   over an existing section of the route, making sure the beginning and end of your trace touches the
   existing route"; Footpath splices the new trace in. An **eraser tool** removes sections from either
   end or from the middle ("Footpath will automatically reconnect the erased area"). Long-press along
   an existing route to route back over it (multi-lap loops). The guide does **not** describe dragging
   individual control points (unlike Strava/RideWithGPS); the trace-over gesture is the core edit primitive.
6. **Undo/redo:** lower-left undo button reverses recent actions; long-press it for **redo** or
   **clear map**.
7. **Live feedback:** distance (and elevation) update as you draw — "measure distance and elevation
   in seconds."

**Likely technical shape (informed speculation):** the finger trace is captured as a polyline of screen
points, downsampled, and sent to a server-side routing/map-matching engine that returns a path
constrained to the OSM way network per activity profile; magnet-off segments are stored as raw
geometry between snapped legs. The FAQ confirms snapping is server-dependent: "Route planning
features like snap-to-roads require internet" ([FAQ](https://footpathapp.com/support/faq/)).

## 3. Feature Catalog

### Route creation & editing
- Finger/Pencil trace with snap-to-path; magnet toggle for straight-line (crow-flies) segments.
- Long-press point-to-point auto-routing with **activity mode selection** — the app "prompts you to
  select whether you want to walk, bike, or drive"; cycling routing "avoids steep hills and prefers
  dedicated bike paths" ([Bike paths guide](https://footpathapp.com/user-guide/maps/bike-paths/)).
  Exact profile list (e.g., separate road bike vs. MTB vs. hiking profiles) **(unverified)** beyond
  walk/bike/drive + straight-line.
- Loop / Out & Back / Reverse / Set-as-Start tools; trace-over re-routing; eraser; undo/redo/clear.
- **Waypoints:** add marker points along a route (user-guide section "Waypoints").
- Eraser doubles as a **GPX track cleaner** for messy imported recordings.

### Measurement & elevation
- Live distance readout while drawing; elevation gain/loss per route.
- **Interactive elevation profile** ([guide](https://footpathapp.com/user-guide/elevation-profiles/)):
  toggle via an "elevation" button; **scrub** with a finger to read distance/elevation at any point;
  **pinch-to-zoom** the graph; tap any point on a saved route for exact elevation.
- **Slope/grade analysis (Elite):** color-coded steep sections synchronized between map and graph —
  yellow 3–7%, orange 7–16%, red 16–25%, maroon >25%; "all ascents steeper than 3% grade" shown when
  the profile is open; grade values shown while scrubbing.
- Elevation data source not published **(unverified — likely a global DEM such as SRTM/Mapbox
  Terrain-RGB)**.

### Maps ([Maps and legends](https://footpathapp.com/user-guide/maps/))
- **Free layers:** Mapbox Outdoors (default; contour lines, paths/parks emphasis), Satellite.
- **Elite layers:** Footpath Topo (proprietary OSM-based topo), Satellite Topo, Satellite 3D,
  Satellite Live, Satellite NAIP; OpenCycleMap, Thunderforest Landscape, Thunderforest Outdoors;
  regional official topo: USGS (US), NOAA nautical charts, Ordnance Survey (UK), IGN France,
  SwissTopo, IGN Spain, Norway/Sweden/Finland/Denmark topo, NZ Topo, Japan Topo.
- **Elite overlays** (on Footpath Topo): contour lines, slope-angle overlay, bike paths, UK Public
  Rights of Way.
- **Interactive POIs** with Wikipedia integration (v4.10, App Store release notes).
- **Offline maps (Elite):** permanent map downloads; free tier gets temporary tile caching. Offline
  behavior: navigate saved routes offline with audio cues; snap-to-roads planning still needs internet.
- No evidence of a popularity heatmap layer (Strava-style) **(not found — likely absent)**.

### Navigation (Elite)
- **Turn-by-turn voice navigation** on iPhone, Android, and Apple Watch; cues saved with the route
  for fully offline guidance ([guide](https://footpathapp.com/user-guide/turn-by-turn-navigation/)).
- **Cue sheets** (Elite): generated, customizable, exportable.
- **GPS tracking** of workouts/trips; manual workout logging (Elite); Apple Health sync;
  battery-preservation guidance.

### Library, sync, sharing
- Save routes: **5 max free, unlimited with Elite**; Elite adds **custom lists**, and
  **merge / duplicate / split** routes.
- Route **sharing** with other users free; overlay routes on photos (share graphic).
- Sync across devices exists but has been flaky historically (a reviewer noted iPad→iPhone routes
  "don't reliably sync" — [Mitch Wagner review](https://mitchw-test.micro.blog/2024/02/22/app-review-map.html)).
  Sync mechanism (iCloud vs. own account backend) **(unverified; an account system is implied by the
  Android + web versions)**.
- **Service syncing** with **Strava and Garmin Connect** (user-guide "Service syncing").

### Import / export
- **GPX import** free-tier ([guide](https://footpathapp.com/user-guide/importing-gpx-files/)).
- **Export (Elite):** GPX, **TCX and FIT course export** "for turn-by-turn navigation on Garmin and
  Wahoo GPS devices"; cue-sheet export; **print maps to PDF** (Elite). KML support not confirmed
  **(unverified)**.

## 4. Tech Stack (verified vs. speculative)

**Verified:**
- **OpenStreetMap** is the routing/coverage backbone: "Our Footpath maps have coverage for the entire
  world, where roads and trails have been mapped by OpenStreetMap" ([FAQ](https://footpathapp.com/support/faq/)).
  The user guide even has a "Reporting mapping issues" page directing fixes to OSM.
- **Mapbox** provides base maps: "Mapbox Outdoors" and Satellite are the free layers
  ([user guide](https://footpathapp.com/user-guide/maps/mapbox-outdoors/)); Mapbox SDK usage is also
  reflected in app-package metadata (AppBrain library listings).
- **Thunderforest** (OpenCycleMap/Landscape/Outdoors) and national agencies (USGS, OS, IGN,
  SwissTopo, etc.) supply premium raster layers.
- Snapping requires a server round-trip (offline planning limitation, per FAQ) — so routing is
  service-side, not fully on-device.

**Speculative (unverified):**
- The routing engine is not publicly named. Given per-activity profiles, hill-avoidance for cycling,
  and trace-matching, it is plausibly a self-hosted/customized OSM engine (Valhalla, GraphHopper, or
  OSRM class) or fully custom; the finger-trace snapping resembles **map matching** (e.g., Valhalla's
  `trace_route`) more than plain A-to-B routing.
- Elevation likely from a global DEM tile set (Mapbox Terrain-RGB / SRTM-derived).
- "Satellite 3D" implies Mapbox GL terrain/3D rendering.

## 5. Pricing / Tiers

- **Free:** draw/snap routes, distance + elevation profile, 5 saved routes, GPX import, sharing,
  Mapbox Outdoors + Satellite layers, temporary offline caching.
- **Footpath Elite:** **$3.99/month or $23.49/year** (US App Store listing; regional prices vary and
  may change) — unlimited routes, custom lists, merge/duplicate/split, all premium/3D/regional topo
  maps + overlays, permanent offline maps, turn-by-turn audio navigation (phone + Apple Watch), cue
  sheets, GPS workout recording + Apple Health, GPX/TCX/FIT export, PDF map printing, slope/grade
  coloring. Free trial available; after expiry, premium features lock but previously saved routes
  remain accessible (except trial-created routes) ([FAQ](https://footpathapp.com/support/faq/)).

## 6. Implications for a Clone

**Core (MVP) features — the product is these four things:**
1. **Trace-to-snap drawing** — capture finger polyline → map-match to OSM network → replace with
   snapped geometry. Open building blocks: **Valhalla** (`trace_route` map matching + costing models
   for pedestrian/bicycle/auto — closest single match to Footpath's behavior), or **BRouter**
   (excellent bike/foot profiles) / **GraphHopper** / **OSRM** (fast A-to-B; OSRM's `match` service
   also does trace matching).
2. **Tap/long-press point-to-point routing** with profile selector + magnet-off straight-line mode
   (client-side geodesic segments stored alongside routed legs).
3. **Live distance + interactive elevation profile** — sample the snapped polyline against a DEM:
   **Open-Elevation**, **OpenTopoData** (SRTM/ASTER/NED), or self-hosted **Mapbox Terrain-RGB style
   tiles from terrarium/AWS elevation tiles**; render with a scrubbable chart (d3/uPlot/Recharts).
4. **Edit primitives:** undo/redo stack over route-leg list; trace-over splice (find nearest points
   on existing route for trace start/end, replace interval); eraser = delete interval + re-route gap;
   Loop (route end→start), Out & Back (append reversed geometry), Reverse.

**Maps:** **MapLibre GL** (web + native) with free vector tiles (OpenFreeMap, Protomaps, or
OpenMapTiles self-hosted) replaces Mapbox without license cost; raster topo via OpenTopoMap;
satellite via Esri World Imagery (check ToS) or Sentinel-2.

**Nice-to-have (post-MVP), roughly in Footpath's own free→Elite order:**
- GPX import (free-tier parity; trivial with a GPX parser) and export; TCX/FIT export later
  (`fit-file-writer`/Garmin FIT SDK).
- Route library + auth + sync (any BaaS or simple Postgres/PostGIS backend).
- Slope-grade coloring (pure client-side math once elevation samples exist).
- Offline maps (MapLibre offline regions / PMTiles), turn-by-turn voice (Valhalla returns maneuvers;
  MapLibre Navigation SDKs exist), cue sheets, watch apps, Strava/Garmin OAuth sync, PDF printing.
- Skip initially: proprietary topo styles, 3D satellite, POI/Wikipedia layer, regional government maps.

**Key architectural takeaway:** Footpath is a thin, gesture-first client over (a) an OSM routing/
map-matching service, (b) commercial tile providers, and (c) a DEM elevation service — all three have
mature open-source substitutes, so the clone's hard part is the **drawing UX** (gesture capture,
trace-over editing, snappy round-trips), not the backend.

---

### Source list
- https://footpathapp.com — official site
- https://footpathapp.com/support/faq/ — FAQ (OSM coverage, offline behavior, Elite, platforms)
- https://footpathapp.com/user-guide/ — guide index
- https://footpathapp.com/user-guide/drawing-a-route/ — draw mode, magnet toggle, loop/out-and-back/reverse
- https://footpathapp.com/user-guide/modifying-a-route/ — trace-over editing, eraser, set-as-start
- https://footpathapp.com/user-guide/elevation-profiles/ — scrubbing, pinch-zoom, grade colors
- https://footpathapp.com/user-guide/maps/ — full layer list and sources
- https://apps.apple.com/us/app/footpath-route-planner/id634845718 — App Store listing (pricing, feature copy)
- https://play.google.com/store/apps/details?id=com.halfmilelabs.footpath — Play Store listing
- https://www.dcrainmaker.com/2019/05/reviews-footpath-planner.html — DC Rainmaker review
- https://mitchw-test.micro.blog/2024/02/22/app-review-map.html — Mitch Wagner review (sync caveat)
