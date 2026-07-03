// ============================================================================
// FOOTPATH CLONE — CONFIG
// Everything you'd normally want to customize lives in this one file.
// No API keys are required with the defaults below (all free/open services).
// ============================================================================

window.FP_CONFIG = {

  // --- Startup view -----------------------------------------------------
  startCenter: [37.7694, -122.4862], // [lat, lng] — Golden Gate Park, SF
  startZoom: 14,

  // --- Units: 'imperial' (miles / feet) or 'metric' (km / m) -------------
  units: 'imperial',

  // --- Base map tiles -----------------------------------------------------
  // Swap the whole `tiles` object for a different look. Alternatives:
  //   OpenTopoMap (topo):  url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  //                        attribution: 'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)'
  //   CyclOSM (cycling):   url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
  //                        attribution: 'CyclOSM | Map data © OpenStreetMap contributors'
  //   Esri satellite:      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  //                        attribution: 'Tiles © Esri', and remove {s}
  tiles: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },

  // --- Routing (the snap-to-path engine) ----------------------------------
  // engine: 'osrm' (default, fast, reliable) or 'brouter' (better trail
  // fidelity for hiking, includes elevation in responses).
  // Both defaults are free public servers. For full control / offline use,
  // self-host and point these URLs at localhost (see README).
  router: {
    engine: 'osrm',

    // FOSSGIS-run OSRM demo servers (the same ones openstreetmap.org uses).
    // Each routing profile maps to a server endpoint.
    osrm: {
      endpoints: {
        walk: 'https://routing.openstreetmap.de/routed-foot',
        hike: 'https://routing.openstreetmap.de/routed-foot', // OSRM has no hike profile; see README
        bike: 'https://routing.openstreetmap.de/routed-bike',
      },
    },

    // BRouter public server. Profile names must exist on the server —
    // see https://brouter.de/brouter-web for the list.
    brouter: {
      url: 'https://brouter.de/brouter',
      profiles: {
        walk: 'shortest',
        hike: 'hiking-mountain',
        bike: 'trekking',
      },
    },
  },

  // --- Elevation ----------------------------------------------------------
  // Used when the router doesn't return elevation (OSRM doesn't; BRouter does).
  // Default: Open-Meteo elevation API — free, no key, CORS-enabled, reliable.
  // Alternatives:
  //   provider: 'openelevation',  url: 'https://api.open-elevation.com/api/v1/lookup'
  //   provider: 'opentopodata',   url: 'http://localhost:5000/v1/mapzen'
  //     (the PUBLIC opentopodata API blocks browser CORS — only use it self-hosted)
  elevation: {
    provider: 'openmeteo',
    url: 'https://api.open-meteo.com/v1/elevation',
    maxSamples: 100,       // route is downsampled to this many points for the profile
    debounceMs: 800,       // wait for editing to settle before querying
  },

  // --- Geocoder (the search box) — Nominatim, free, no key ----------------
  geocoder: {
    url: 'https://nominatim.openstreetmap.org/search',
  },

  // --- Routing profiles shown in the toolbar ------------------------------
  // key: internal id (must match router endpoint/profile maps above)
  // 'direct' is the no-snap straight-line mode (always available).
  profiles: [
    { key: 'walk',   label: 'Walk',     color: '#e8590c' },
    { key: 'hike',   label: 'Hike',     color: '#2f9e44' },
    { key: 'bike',   label: 'Bike',     color: '#1971c2' },
    { key: 'direct', label: 'Straight', color: '#868e96' },
  ],

  // --- Look & feel ---------------------------------------------------------
  colors: {
    routeCasing: '#ffffff',     // white outline under route lines
    waypoint: '#ffffff',        // waypoint dot fill
    waypointBorder: '#212529',  // waypoint dot ring
    drawStroke: '#f03e3e',      // the temporary freehand line while drawing
    chartFill: 'rgba(47, 158, 68, 0.25)',
    chartLine: '#2f9e44',
  },

  routeStyle: { weight: 5, opacity: 0.95, casingWeight: 9 },

  // Freehand draw mode: how the rough stroke is turned into snap points.
  draw: {
    minPixelGap: 8,     // min px between captured stroke points
    viaPixelGap: 70,    // px between the via-points sent to the router
    maxViaPoints: 12,   // cap per stroke (keeps routing fast)
  },

  gpx: { creator: 'footpath-clone', trackName: 'My Route' },
};
