/* ============================================================================
 * FOOTPATH CLONE — app logic
 * Click to add snapped waypoints, or Draw mode to trace a rough line that
 * snaps to real paths. Live distance, elevation profile, GPX import/export,
 * undo/redo, out-and-back, loop closing, per-segment routing profiles.
 * All service endpoints/colors/units come from config.js.
 * ==========================================================================*/
(function () {
  'use strict';

  const CFG = window.FP_CONFIG;

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------
  // waypoints[i] = {lat, lng}
  // segments[i] connects waypoints[i] -> waypoints[i+1]:
  //   { coords: [[lat, lng, ele?], ...], distance: meters, profile: key, fallback?: bool }
  const state = {
    waypoints: [],
    segments: [],
    currentProfile: CFG.profiles[0].key,
  };

  let undoStack = [];
  let redoStack = [];
  const MAX_UNDO = 100;

  // Serialized queue so rapid clicks / drags / strokes can't interleave routing.
  let opQueue = Promise.resolve();
  function enqueue(fn) {
    opQueue = opQueue.then(fn).catch((e) => {
      console.error(e);
      toast('Something went wrong: ' + e.message);
    });
    return opQueue;
  }

  let busyCount = 0;
  function busy(on) {
    busyCount += on ? 1 : -1;
    document.getElementById('stat-busy').hidden = busyCount <= 0;
  }

  // --------------------------------------------------------------------------
  // Map setup
  // --------------------------------------------------------------------------
  const map = L.map('map', { zoomControl: true }).setView(CFG.startCenter, CFG.startZoom);
  L.tileLayer(CFG.tiles.url, {
    attribution: CFG.tiles.attribution,
    maxZoom: CFG.tiles.maxZoom,
  }).addTo(map);

  const routeLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  let hoverDot = null; // map marker mirroring elevation-chart hover

  function profileColor(key) {
    if (key === 'trail') return CFG.trails.color;
    const p = CFG.profiles.find((p) => p.key === key);
    return p ? p.color : '#868e96';
  }

  // A waypoint that borders a trail segment can't be dragged — re-routing
  // would destroy the recorded track (delete the trail or undo instead).
  function isTrailLocked(i) {
    return (state.segments[i - 1] && state.segments[i - 1].profile === 'trail') ||
           (state.segments[i] && state.segments[i].profile === 'trail');
  }

  // --------------------------------------------------------------------------
  // Geometry helpers
  // --------------------------------------------------------------------------
  function haversine(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function pathLength(coords) {
    let d = 0;
    for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
    return d;
  }

  function totalDistance() {
    return state.segments.reduce((s, seg) => s + seg.distance, 0);
  }

  // Full route geometry: all segment coords concatenated, no duplicate joints.
  function fullGeometry() {
    const out = [];
    for (const seg of state.segments) {
      for (const c of seg.coords) {
        const last = out[out.length - 1];
        if (last && last[0] === c[0] && last[1] === c[1]) continue;
        out.push(c);
      }
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // Routing engines (snap-to-path)
  // --------------------------------------------------------------------------
  function directSegment(a, b, profile) {
    const coords = [[a.lat, a.lng], [b.lat, b.lng]];
    return { coords, distance: pathLength(coords), profile };
  }

  async function routeOSRM(a, b, profile) {
    const base = CFG.router.osrm.endpoints[profile];
    if (!base) return directSegment(a, b, profile);
    const url = `${base}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}` +
      `?overview=full&geometries=geojson&steps=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('router HTTP ' + res.status);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
      throw new Error('no route found');
    }
    const route = data.routes[0];
    const coords = route.geometry.coordinates.map((c) => [c[1], c[0]]);
    return { coords, distance: route.distance, profile };
  }

  async function routeBRouter(a, b, profile) {
    const p = CFG.router.brouter.profiles[profile];
    if (!p) return directSegment(a, b, profile);
    const url = `${CFG.router.brouter.url}?lonlats=${a.lng},${a.lat}|${b.lng},${b.lat}` +
      `&profile=${encodeURIComponent(p)}&alternativeidx=0&format=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('router HTTP ' + res.status);
    const data = await res.json();
    const feat = data.features && data.features[0];
    if (!feat) throw new Error('no route found');
    const coords = feat.geometry.coordinates.map((c) => [c[1], c[0], c[2]]);
    const distance = parseFloat(feat.properties['track-length']) || pathLength(coords);
    return { coords, distance, profile };
  }

  async function routeSegment(a, b, profile) {
    if (profile === 'direct') return directSegment(a, b, profile);
    busy(true);
    try {
      return CFG.router.engine === 'brouter'
        ? await routeBRouter(a, b, profile)
        : await routeOSRM(a, b, profile);
    } catch (e) {
      console.warn('Routing failed, falling back to straight line:', e.message);
      toast('Routing failed (' + e.message + ') — drew a straight line instead');
      const seg = directSegment(a, b, profile);
      seg.fallback = true;
      return seg;
    } finally {
      busy(false);
    }
  }

  // --------------------------------------------------------------------------
  // Undo / redo — snapshots of the whole route (segments included, so undo
  // never needs to re-hit the routing server)
  // --------------------------------------------------------------------------
  function serialize() {
    return JSON.stringify({ waypoints: state.waypoints, segments: state.segments });
  }
  function restore(json) {
    const s = JSON.parse(json);
    state.waypoints = s.waypoints;
    state.segments = s.segments;
  }
  function pushUndo() {
    undoStack.push(serialize());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(serialize());
    restore(undoStack.pop());
    render(); updateAll();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(serialize());
    restore(redoStack.pop());
    render(); updateAll();
  }

  // --------------------------------------------------------------------------
  // Route mutations (all called through enqueue())
  // --------------------------------------------------------------------------
  async function addWaypoint(latlng, { snapshot = true } = {}) {
    if (snapshot) pushUndo();
    const wp = { lat: latlng.lat, lng: latlng.lng };
    const prev = state.waypoints[state.waypoints.length - 1];
    state.waypoints.push(wp);
    if (prev) {
      const seg = await routeSegment(prev, wp, state.currentProfile);
      // Snap the placed point (and the very first point) onto the routed path,
      // like Footpath does.
      const first = seg.coords[0], last = seg.coords[seg.coords.length - 1];
      if (state.segments.length === 0) { prev.lat = first[0]; prev.lng = first[1]; }
      wp.lat = last[0]; wp.lng = last[1];
      state.segments.push(seg);
    }
    render(); updateAll();
  }

  async function moveWaypoint(i, latlng) {
    if (isTrailLocked(i)) { render(); return; } // safety net; marker isn't draggable
    const wp = state.waypoints[i];
    wp.lat = latlng.lat; wp.lng = latlng.lng;
    // Re-route the segment(s) touching this waypoint.
    if (i > 0) {
      const seg = await routeSegment(state.waypoints[i - 1], wp, state.segments[i - 1].profile);
      const last = seg.coords[seg.coords.length - 1];
      wp.lat = last[0]; wp.lng = last[1];
      state.segments[i - 1] = seg;
    }
    if (i < state.waypoints.length - 1) {
      const seg = await routeSegment(wp, state.waypoints[i + 1], state.segments[i].profile);
      if (i === 0) {
        const first = seg.coords[0];
        wp.lat = first[0]; wp.lng = first[1];
      }
      state.segments[i] = seg;
    }
    render(); updateAll();
  }

  async function deleteWaypoint(i) {
    pushUndo();
    if (state.waypoints.length <= 1) {
      state.waypoints = []; state.segments = [];
    } else if (i === 0) {
      state.waypoints.shift(); state.segments.shift();
    } else if (i === state.waypoints.length - 1) {
      state.waypoints.pop(); state.segments.pop();
    } else if (isTrailLocked(i)) {
      undoStack.pop(); // undo the snapshot we just took
      toast('That point anchors a trail — delete from the route end, or use Undo');
      return;
    } else {
      const joined = await routeSegment(
        state.waypoints[i - 1], state.waypoints[i + 1], state.segments[i].profile);
      state.waypoints.splice(i, 1);
      state.segments.splice(i - 1, 2, joined);
    }
    render(); updateAll();
  }

  function outAndBack() {
    if (!state.segments.length) return;
    pushUndo();
    const nSeg = state.segments.length;
    for (let i = nSeg - 1; i >= 0; i--) {
      const s = state.segments[i];
      state.segments.push({
        coords: s.coords.slice().reverse().map((c) => c.slice()),
        distance: s.distance,
        profile: s.profile,
        meta: s.meta ? { ...s.meta } : undefined,
      });
    }
    const nWp = state.waypoints.length;
    for (let i = nWp - 2; i >= 0; i--) {
      state.waypoints.push({ ...state.waypoints[i] });
    }
    render(); updateAll();
  }

  async function closeLoop() {
    if (state.waypoints.length < 2) return;
    pushUndo();
    const last = state.waypoints[state.waypoints.length - 1];
    const first = state.waypoints[0];
    const seg = await routeSegment(last, first, state.currentProfile);
    const end = seg.coords[seg.coords.length - 1];
    state.waypoints.push({ lat: end[0], lng: end[1] });
    state.segments.push(seg);
    render(); updateAll();
  }

  function clearRoute() {
    if (!state.waypoints.length) return;
    pushUndo();
    state.waypoints = []; state.segments = [];
    render(); updateAll();
  }

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------
  function render() {
    routeLayer.clearLayers();
    markerLayer.clearLayers();

    for (const seg of state.segments) {
      const latlngs = seg.coords.map((c) => [c[0], c[1]]);
      L.polyline(latlngs, {
        color: CFG.colors.routeCasing,
        weight: CFG.routeStyle.casingWeight,
        opacity: 0.9,
      }).addTo(routeLayer);
      L.polyline(latlngs, {
        color: profileColor(seg.profile),
        weight: CFG.routeStyle.weight,
        opacity: CFG.routeStyle.opacity,
        dashArray: seg.profile === 'direct' || seg.fallback ? '6 8' : null,
      }).addTo(routeLayer);
    }

    state.waypoints.forEach((wp, i) => {
      const isEnd = i === 0 || i === state.waypoints.length - 1;
      const locked = isTrailLocked(i);
      const icon = L.divIcon({
        className: '',
        html: `<div class="wp-icon${isEnd ? ' endpoint' : ''}" style="` +
          `background:${locked ? CFG.trails.color : CFG.colors.waypoint};` +
          `border-color:${CFG.colors.waypointBorder}"></div>`,
        iconSize: isEnd ? [24, 24] : [20, 20],
        iconAnchor: isEnd ? [12, 12] : [10, 10],
      });
      const m = L.marker([wp.lat, wp.lng], { icon, draggable: !locked });
      if (!locked) {
        m.on('dragstart', () => pushUndo());
        m.on('dragend', (e) => {
          const ll = e.target.getLatLng();
          enqueue(() => moveWaypoint(i, ll));
        });
      }
      m.on('contextmenu', () => enqueue(() => deleteWaypoint(i)));
      m.bindTooltip(locked ? 'Trail anchor · right-click to delete (from route end)' :
        i === 0 ? 'Start (drag to move, right-click to delete)' :
        'Drag to move · right-click to delete', { direction: 'top', opacity: 0.85 });
      m.addTo(markerLayer);
    });
  }

  // --------------------------------------------------------------------------
  // Stats + buttons
  // --------------------------------------------------------------------------
  const imperial = CFG.units === 'imperial';
  function fmtDistance(m) {
    return imperial ? (m / 1609.344).toFixed(2) + ' mi' : (m / 1000).toFixed(2) + ' km';
  }
  function fmtElev(m) {
    return imperial ? Math.round(m * 3.28084).toLocaleString() + ' ft'
                    : Math.round(m).toLocaleString() + ' m';
  }

  function updateAll() {
    document.getElementById('stat-distance').textContent = fmtDistance(totalDistance());
    document.getElementById('stat-points').textContent = state.waypoints.length;

    const hasRoute = state.segments.length > 0;
    document.getElementById('btn-undo').disabled = !undoStack.length;
    document.getElementById('btn-redo').disabled = !redoStack.length;
    document.getElementById('btn-outback').disabled = !hasRoute;
    document.getElementById('btn-loop').disabled = state.waypoints.length < 2;
    document.getElementById('btn-clear').disabled = !state.waypoints.length;
    document.getElementById('btn-export').disabled = !hasRoute;
    document.getElementById('hint').style.display = state.waypoints.length ? 'none' : '';

    updateTimeEstimate();
    scheduleElevation();
  }

  // --------------------------------------------------------------------------
  // Elevation profile
  // --------------------------------------------------------------------------
  let elevSamples = [];       // [{d: meters-from-start, ele, lat, lng}]
  let elevTimer = null;
  let elevAbort = null;
  let elevGeneration = 0;

  function scheduleElevation() {
    clearTimeout(elevTimer);
    if (elevAbort) { elevAbort.abort(); elevAbort = null; }
    const geom = fullGeometry();
    if (geom.length < 2) {
      elevSamples = [];
      setElevStats(null);
      drawChart();
      return;
    }
    // Downsample the route to <= maxSamples points, evenly spaced by distance.
    const samples = resample(geom, CFG.elevation.maxSamples);
    // If the router already gave us elevation (BRouter, or an imported GPX
    // with <ele>), no network call is needed.
    if (samples.every((s) => s.ele != null)) {
      elevSamples = samples;
      finishElevation();
      return;
    }
    elevTimer = setTimeout(() => fetchElevation(samples), CFG.elevation.debounceMs);
  }

  function resample(geom, n) {
    const cum = [0];
    for (let i = 1; i < geom.length; i++) {
      cum.push(cum[i - 1] + haversine(geom[i - 1], geom[i]));
    }
    const total = cum[cum.length - 1];
    if (total === 0 || geom.length <= n) {
      return geom.map((c, i) => ({ d: cum[i], lat: c[0], lng: c[1], ele: c[2] ?? null }));
    }
    const out = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const target = (total * k) / (n - 1);
      while (j < cum.length - 1 && cum[j + 1] < target) j++;
      const c = geom[Math.min(j + (target - cum[j] > cum[j + 1] - target ? 1 : 0), geom.length - 1)];
      out.push({ d: target, lat: c[0], lng: c[1], ele: c[2] ?? null });
    }
    return out;
  }

  async function fetchElevation(samples) {
    const gen = ++elevGeneration;
    elevAbort = new AbortController();
    busy(true);
    try {
      let elevations;
      if (CFG.elevation.provider === 'openmeteo') {
        // Open-Meteo takes comma-separated lat/lng lists, max 100 per call.
        const lats = samples.map((s) => s.lat.toFixed(5)).join(',');
        const lngs = samples.map((s) => s.lng.toFixed(5)).join(',');
        const res = await fetch(
          `${CFG.elevation.url}?latitude=${lats}&longitude=${lngs}`,
          { signal: elevAbort.signal });
        if (!res.ok) throw new Error('elevation HTTP ' + res.status);
        elevations = (await res.json()).elevation;
      } else if (CFG.elevation.provider === 'openelevation') {
        const res = await fetch(CFG.elevation.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locations: samples.map((s) => ({ latitude: s.lat, longitude: s.lng })),
          }),
          signal: elevAbort.signal,
        });
        if (!res.ok) throw new Error('elevation HTTP ' + res.status);
        elevations = (await res.json()).results.map((r) => r.elevation);
      } else {
        const locs = samples.map((s) => s.lat.toFixed(5) + ',' + s.lng.toFixed(5)).join('|');
        const res = await fetch(CFG.elevation.url + '?locations=' + locs,
          { signal: elevAbort.signal });
        if (!res.ok) throw new Error('elevation HTTP ' + res.status);
        elevations = (await res.json()).results.map((r) => r.elevation);
      }
      if (gen !== elevGeneration) return; // a newer request superseded us
      samples.forEach((s, i) => { s.ele = elevations[i]; });
      elevSamples = samples.filter((s) => s.ele != null);
      finishElevation();
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.warn('Elevation lookup failed:', e.message);
        setElevStats(null);
      }
    } finally {
      busy(false);
    }
  }

  function finishElevation() {
    // Light smoothing so DEM noise doesn't inflate ascent totals.
    const eles = elevSamples.map((s) => s.ele);
    const smooth = eles.map((_, i) => {
      const lo = Math.max(0, i - 1), hi = Math.min(eles.length - 1, i + 1);
      let sum = 0;
      for (let j = lo; j <= hi; j++) sum += eles[j];
      return sum / (hi - lo + 1);
    });
    let up = 0, down = 0;
    for (let i = 1; i < smooth.length; i++) {
      const dif = smooth[i] - smooth[i - 1];
      if (dif > 0) up += dif; else down -= dif;
    }
    setElevStats({ up, down });
    updateTimeEstimate(); // grade adjustment can refine once elevation is known
    drawChart();
  }

  function setElevStats(v) {
    document.getElementById('stat-ascent').textContent = v ? '+' + fmtElev(v.up) : '–';
    document.getElementById('stat-descent').textContent = v ? '−' + fmtElev(v.down) : '–';
  }

  // --------------------------------------------------------------------------
  // Elevation chart (hand-rolled canvas — no chart library dependency)
  // --------------------------------------------------------------------------
  const canvas = document.getElementById('elevation-chart');
  const ctx = canvas.getContext('2d');
  let chartHoverX = null;

  function drawChart() {
    const wrap = document.getElementById('chart-wrap');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (elevSamples.length < 2) {
      wrap.classList.remove('has-data');
      return;
    }
    wrap.classList.add('has-data');

    const padL = 44, padR = 10, padT = 8, padB = 18;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const totalD = elevSamples[elevSamples.length - 1].d;
    let minE = Infinity, maxE = -Infinity;
    for (const s of elevSamples) { minE = Math.min(minE, s.ele); maxE = Math.max(maxE, s.ele); }
    const span = Math.max(maxE - minE, 10);
    minE -= span * 0.08; maxE += span * 0.08;

    const x = (d) => padL + (d / totalD) * plotW;
    const y = (e) => padT + (1 - (e - minE) / (maxE - minE)) * plotH;

    // grid + labels
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#868e96';
    ctx.strokeStyle = '#343a40';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 3; g++) {
      const e = minE + ((maxE - minE) * g) / 3;
      const yy = y(e);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      ctx.fillText(fmtElev(e), 4, yy + 3);
    }
    ctx.fillText('0', padL, H - 5);
    ctx.fillText(fmtDistance(totalD), W - padR - 44, H - 5);

    // area + line
    ctx.beginPath();
    ctx.moveTo(x(elevSamples[0].d), y(elevSamples[0].ele));
    for (const s of elevSamples) ctx.lineTo(x(s.d), y(s.ele));
    ctx.lineTo(x(totalD), padT + plotH);
    ctx.lineTo(x(0), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = CFG.colors.chartFill;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x(elevSamples[0].d), y(elevSamples[0].ele));
    for (const s of elevSamples) ctx.lineTo(x(s.d), y(s.ele));
    ctx.strokeStyle = CFG.colors.chartLine;
    ctx.lineWidth = 2;
    ctx.stroke();

    // hover crosshair
    if (chartHoverX != null) {
      const targetD = ((chartHoverX - padL) / plotW) * totalD;
      let best = elevSamples[0];
      for (const s of elevSamples) {
        if (Math.abs(s.d - targetD) < Math.abs(best.d - targetD)) best = s;
      }
      const hx = x(best.d), hy = y(best.ele);
      ctx.strokeStyle = '#fcc419';
      ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + plotH); ctx.stroke();
      ctx.fillStyle = '#fcc419';
      ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f1f3f5';
      ctx.font = '11px sans-serif';
      const label = fmtDistance(best.d) + ' · ' + fmtElev(best.ele);
      const tx = Math.min(hx + 8, W - padR - ctx.measureText(label).width);
      ctx.fillText(label, tx, Math.max(padT + 10, hy - 8));

      if (!hoverDot) {
        hoverDot = L.circleMarker([best.lat, best.lng], {
          radius: 6, color: '#fcc419', fillColor: '#fcc419', fillOpacity: 0.9,
        }).addTo(map);
      } else {
        hoverDot.setLatLng([best.lat, best.lng]);
      }
    } else if (hoverDot) {
      map.removeLayer(hoverDot);
      hoverDot = null;
    }
  }

  canvas.addEventListener('mousemove', (e) => {
    chartHoverX = e.offsetX;
    drawChart();
  });
  canvas.addEventListener('mouseleave', () => {
    chartHoverX = null;
    drawChart();
  });
  window.addEventListener('resize', drawChart);

  // --------------------------------------------------------------------------
  // Freehand DRAW mode — the Footpath signature: drag a rough line, it snaps
  // --------------------------------------------------------------------------
  let drawMode = false;
  let stroking = false;
  let strokePixels = [];   // container points captured during the stroke
  let strokeLine = null;   // temporary red polyline

  const mapEl = document.getElementById('map');
  const btnDraw = document.getElementById('btn-draw');

  function setDrawMode(on) {
    drawMode = on;
    btnDraw.classList.toggle('active', on);
    mapEl.classList.toggle('drawing', on);
    if (on) map.dragging.disable(); else map.dragging.enable();
  }
  btnDraw.addEventListener('click', () => setDrawMode(!drawMode));

  mapEl.addEventListener('pointerdown', (e) => {
    if (!drawMode || e.button !== 0) return;
    // Don't start a stroke on top of a marker (let dragging work).
    if (e.target.closest && e.target.closest('.leaflet-marker-icon')) return;
    e.preventDefault();
    stroking = true;
    strokePixels = [map.mouseEventToContainerPoint(e)];
    mapEl.setPointerCapture(e.pointerId);
  });

  mapEl.addEventListener('pointermove', (e) => {
    if (!stroking) return;
    const cp = map.mouseEventToContainerPoint(e);
    const last = strokePixels[strokePixels.length - 1];
    if (cp.distanceTo(last) < CFG.draw.minPixelGap) return;
    strokePixels.push(cp);
    const latlngs = strokePixels.map((p) => map.containerPointToLatLng(p));
    if (!strokeLine) {
      strokeLine = L.polyline(latlngs, {
        color: CFG.colors.drawStroke, weight: 4, opacity: 0.8, dashArray: '2 6',
      }).addTo(map);
    } else {
      strokeLine.setLatLngs(latlngs);
    }
  });

  function endStroke(e) {
    if (!stroking) return;
    stroking = false;
    if (strokeLine) { map.removeLayer(strokeLine); strokeLine = null; }
    const pixels = strokePixels;
    strokePixels = [];
    if (pixels.length < 2) return;

    // Thin the stroke into via-points: keep points >= viaPixelGap apart,
    // always keeping the endpoints, capped at maxViaPoints.
    let vias = [pixels[0]];
    for (const p of pixels) {
      if (p.distanceTo(vias[vias.length - 1]) >= CFG.draw.viaPixelGap) vias.push(p);
    }
    const end = pixels[pixels.length - 1];
    if (end.distanceTo(vias[vias.length - 1]) > 2) vias.push(end);
    if (vias.length > CFG.draw.maxViaPoints) {
      const step = (vias.length - 1) / (CFG.draw.maxViaPoints - 1);
      vias = Array.from({ length: CFG.draw.maxViaPoints },
        (_, i) => vias[Math.round(i * step)]);
    }
    const latlngs = vias.map((p) => map.containerPointToLatLng(p));

    // One undo snapshot per stroke, then route through every via point.
    enqueue(async () => {
      pushUndo();
      for (const ll of latlngs) {
        await addWaypoint(ll, { snapshot: false });
      }
    });
  }
  mapEl.addEventListener('pointerup', endStroke);
  mapEl.addEventListener('pointercancel', endStroke);

  // --------------------------------------------------------------------------
  // GPX export / import
  // --------------------------------------------------------------------------
  function exportGPX() {
    const geom = fullGeometry();
    if (geom.length < 2) return;

    // Attach elevations from the profile samples (nearest by distance).
    let cum = 0, si = 0;
    const pts = geom.map((c, i) => {
      if (i > 0) cum += haversine(geom[i - 1], c);
      let ele = c[2];
      if (ele == null && elevSamples.length) {
        while (si < elevSamples.length - 1 &&
               Math.abs(elevSamples[si + 1].d - cum) <= Math.abs(elevSamples[si].d - cum)) si++;
        ele = elevSamples[si].ele;
      }
      return { lat: c[0], lng: c[1], ele };
    });

    const trkpts = pts.map((p) =>
      `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">` +
      (p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : '') + `</trkpt>`
    ).join('\n');

    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${CFG.gpx.creator}" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${CFG.gpx.trackName}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'route.gpx';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importGPX(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const doc = new DOMParser().parseFromString(reader.result, 'application/xml');
      let pts = [...doc.querySelectorAll('trkpt')];
      if (!pts.length) pts = [...doc.querySelectorAll('rtept')];
      if (!pts.length) { toast('No track points found in that GPX'); return; }

      const coords = pts.map((p) => {
        const ele = p.querySelector('ele');
        return [
          parseFloat(p.getAttribute('lat')),
          parseFloat(p.getAttribute('lon')),
          ele ? parseFloat(ele.textContent) : undefined,
        ];
      }).filter((c) => isFinite(c[0]) && isFinite(c[1]));
      if (coords.length < 2) { toast('GPX has fewer than 2 valid points'); return; }

      pushUndo();
      state.waypoints = [];
      state.segments = [];

      // Waypoint handles every ~N track points; original geometry is kept
      // verbatim inside the segments so the imported shape is exact.
      const step = Math.max(1, Math.floor(coords.length / 40));
      const idxs = [];
      for (let i = 0; i < coords.length; i += step) idxs.push(i);
      if (idxs[idxs.length - 1] !== coords.length - 1) idxs.push(coords.length - 1);

      state.waypoints = idxs.map((i) => ({ lat: coords[i][0], lng: coords[i][1] }));
      for (let k = 1; k < idxs.length; k++) {
        const slice = coords.slice(idxs[k - 1], idxs[k] + 1);
        state.segments.push({
          coords: slice,
          distance: pathLength(slice),
          profile: 'direct',
        });
      }
      render(); updateAll();
      map.fitBounds(L.latLngBounds(coords.map((c) => [c[0], c[1]])), { padding: [40, 40] });
    };
    reader.readAsText(file);
  }

  // --------------------------------------------------------------------------
  // Users — lightweight local profiles (localStorage, no backend).
  // Each user owns their imported trail data; nothing leaves this browser.
  // --------------------------------------------------------------------------
  const USERS_KEY = 'fp_users';

  function loadUsers() {
    let u = null;
    try { u = JSON.parse(localStorage.getItem(USERS_KEY)); } catch (e) { /* corrupt -> reseed */ }
    if (!u || !Array.isArray(u.users) || !u.users.length) {
      u = { users: [{ id: 'u_gabe', name: 'Gabe' }], currentUserId: 'u_gabe' };
      localStorage.setItem(USERS_KEY, JSON.stringify(u));
    }
    if (!u.users.find((x) => x.id === u.currentUserId)) u.currentUserId = u.users[0].id;
    return u;
  }
  let users = loadUsers();
  const currentUser = () => users.users.find((x) => x.id === users.currentUserId);

  const userSelect = document.getElementById('user-select');
  function renderUserSelect() {
    userSelect.innerHTML = '';
    for (const u of users.users) {
      const o = document.createElement('option');
      o.value = u.id; o.textContent = '👤 ' + u.name;
      if (u.id === users.currentUserId) o.selected = true;
      userSelect.appendChild(o);
    }
    const add = document.createElement('option');
    add.value = '__new'; add.textContent = '＋ New user…';
    userSelect.appendChild(add);
  }
  userSelect.addEventListener('change', () => {
    if (userSelect.value === '__new') {
      const name = (prompt('Name for the new user profile:') || '').trim();
      if (!name) { renderUserSelect(); return; }
      const u = { id: 'u_' + Date.now().toString(36), name };
      users.users.push(u);
      users.currentUserId = u.id;
    } else {
      users.currentUserId = userSelect.value;
    }
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    renderUserSelect();
    loadTrailData();
  });

  // --------------------------------------------------------------------------
  // My Trails — imported personal runs (e.g. pulled from Strava), stored per
  // user in localStorage. Never bundled with the site; imported from a local
  // JSON file, or auto-loaded from ./strava-runs.json when that file happens
  // to be served next to the app (dev convenience — it's gitignored).
  // --------------------------------------------------------------------------
  const trailsKey = () => 'fp_trails_' + users.currentUserId;
  let trailData = null;          // {athlete, median_pace_s_per_km, runs: [...]}
  const trailsLayer = L.layerGroup().addTo(map);   // faint "show all" overlay
  let trailPreview = null;                          // hover highlight

  function validateTrailData(d) {
    if (!d || !Array.isArray(d.runs)) return 'no "runs" array';
    const ok = d.runs.filter((r) =>
      Array.isArray(r.latlng) && r.latlng.length >= 2 &&
      isFinite(r.distance_m) && isFinite(r.moving_time_s));
    if (!ok.length) return 'no runs with latlng + distance + time';
    return null;
  }

  // Keep only what the app needs (drops anything unexpected, incl. any
  // token-shaped fields that should never be there in the first place).
  function slimTrailData(d) {
    return {
      athlete: { firstname: (d.athlete && d.athlete.firstname) || currentUser().name },
      generated_at: d.generated_at || null,
      note: d.note || null,
      median_pace_s_per_km: isFinite(d.median_pace_s_per_km) ? d.median_pace_s_per_km : null,
      runs: d.runs
        .filter((r) => Array.isArray(r.latlng) && r.latlng.length >= 2 &&
                       isFinite(r.distance_m) && isFinite(r.moving_time_s))
        .map((r) => ({
          id: String(r.id),
          name: r.name || 'Run',
          sport_type: r.sport_type || 'Run',
          start_date: r.start_date || null,
          distance_m: r.distance_m,
          moving_time_s: r.moving_time_s,
          elev_gain_m: isFinite(r.elev_gain_m) ? r.elev_gain_m : null,
          pace_s_per_km: isFinite(r.pace_s_per_km)
            ? r.pace_s_per_km
            : r.moving_time_s / (r.distance_m / 1000),
          latlng: r.latlng.map((c) => [+(+c[0]).toFixed(5), +(+c[1]).toFixed(5)]),
        })),
    };
  }

  function importTrailData(raw) {
    const err = validateTrailData(raw);
    if (err) { toast('Import failed: ' + err); return false; }
    trailData = slimTrailData(raw);
    try {
      localStorage.setItem(trailsKey(), JSON.stringify(trailData));
    } catch (e) {
      toast('Imported, but too large to persist in this browser (' + e.name + ')');
    }
    renderTrailsPanel();
    renderTrailsLayer();
    updateTimeEstimate();
    toast(`Imported ${trailData.runs.length} runs for ${currentUser().name}`);
    return true;
  }

  function loadTrailData() {
    trailData = null;
    try { trailData = JSON.parse(localStorage.getItem(trailsKey())); } catch (e) { /* none */ }
    renderTrailsPanel();
    renderTrailsLayer();
    updateTimeEstimate();
  }

  function medianPaceSPerKm() {
    if (!trailData) return null;
    if (isFinite(trailData.median_pace_s_per_km) && trailData.median_pace_s_per_km > 0) {
      return trailData.median_pace_s_per_km;
    }
    const paces = trailData.runs.map((r) => r.pace_s_per_km).filter((p) => isFinite(p)).sort((a, b) => a - b);
    return paces.length ? paces[Math.floor(paces.length / 2)] : null;
  }

  function fmtPace(sPerKm) {
    const s = imperial ? sPerKm * 1.609344 : sPerKm;
    const m = Math.floor(s / 60), r = Math.round(s % 60);
    return `${m}:${String(r).padStart(2, '0')} /${imperial ? 'mi' : 'km'}`;
  }
  function fmtDuration(sec) {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
                 : `${m}:${String(s).padStart(2, '0')}`;
  }

  // ---- Panel -----------------------------------------------------------------
  const trailsPanel = document.getElementById('trails-panel');

  function renderTrailsPanel() {
    document.getElementById('tp-user').textContent = currentUser().name;
    const list = document.getElementById('tp-list');
    const meta = document.getElementById('tp-meta');
    list.innerHTML = '';
    if (!trailData || !trailData.runs.length) {
      meta.textContent = '';
      list.innerHTML = '<div class="tp-empty">No trails yet for this user.<br><br>' +
        'Tap <b>⤒ Load my trails</b> and pick your <code>strava-runs.json</code> ' +
        '(works on phone too — the file just needs to be on the device).</div>';
      return;
    }
    const mp = medianPaceSPerKm();
    const dates = trailData.runs.map((r) => r.start_date).filter(Boolean).sort();
    const fmtD = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    meta.textContent = `${trailData.runs.length} runs` +
      (dates.length ? ` · ${fmtD(dates[0])} – ${fmtD(dates[dates.length - 1])}` : '') +
      (mp ? ` · median ${fmtPace(mp)}` : '');

    for (const run of trailData.runs) {
      const item = document.createElement('div');
      item.className = 'tp-item';
      const info = document.createElement('div');
      info.className = 'tp-info';
      info.innerHTML = `<div class="tp-name">${run.name.replace(/</g, '&lt;')}</div>` +
        `<div class="tp-sub">${fmtD(run.start_date)} · ${fmtDistance(run.distance_m)} · ${fmtPace(run.pace_s_per_km)}</div>`;
      const btn = document.createElement('button');
      btn.className = 'tp-add';
      btn.textContent = '+ Add';
      btn.title = 'Add this run to the route';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        enqueue(() => addTrailToRoute(run));
      });
      item.appendChild(info);
      item.appendChild(btn);
      item.addEventListener('mouseenter', () => previewTrail(run));
      item.addEventListener('mouseleave', () => previewTrail(null));
      item.addEventListener('click', () => {
        map.fitBounds(L.latLngBounds(run.latlng), { padding: [60, 60] });
        previewTrail(run);
      });
      list.appendChild(item);
    }
  }

  function previewTrail(run) {
    if (trailPreview) { map.removeLayer(trailPreview); trailPreview = null; }
    if (run) {
      trailPreview = L.polyline(run.latlng, {
        color: CFG.trails.color, weight: 6, opacity: 0.9, interactive: false,
      }).addTo(map);
    }
  }

  function renderTrailsLayer() {
    trailsLayer.clearLayers();
    if (!trailData || !document.getElementById('tp-showall').checked) return;
    for (const run of trailData.runs) {
      L.polyline(run.latlng, {
        color: CFG.trails.faintColor, weight: CFG.trails.faintWeight,
        opacity: CFG.trails.faintOpacity,
      }).bindTooltip(`${run.name} — ${fmtDistance(run.distance_m)} (click to add)`,
        { sticky: true, opacity: 0.85 })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e); // don't also drop a waypoint
          enqueue(() => addTrailToRoute(run));
        })
        .addTo(trailsLayer);
    }
  }

  // ---- Stitch a trail into the route ------------------------------------------
  async function addTrailToRoute(run) {
    pushUndo();
    let coords = run.latlng.map((c) => [c[0], c[1]]);

    if (state.waypoints.length) {
      const lastWp = state.waypoints[state.waypoints.length - 1];
      // Orient the trail so its nearer end faces the current route end.
      const dStart = haversine([lastWp.lat, lastWp.lng], coords[0]);
      const dEnd = haversine([lastWp.lat, lastWp.lng], coords[coords.length - 1]);
      if (dEnd < dStart) coords = coords.slice().reverse();
      // Connector segment (snapped, current profile) unless already touching.
      const gap = Math.min(dStart, dEnd);
      if (gap > 5) {
        const trailStart = { lat: coords[0][0], lng: coords[0][1] };
        const conn = await routeSegment(lastWp, trailStart, state.currentProfile);
        state.waypoints.push(trailStart);
        state.segments.push(conn);
      }
    } else {
      state.waypoints.push({ lat: coords[0][0], lng: coords[0][1] });
    }

    state.waypoints.push({ lat: coords[coords.length - 1][0], lng: coords[coords.length - 1][1] });
    state.segments.push({
      coords,
      distance: run.distance_m, // the run's recorded distance (geometry is a reduced polyline)
      profile: 'trail',
      meta: { runId: run.id, name: run.name, pace_s_per_km: run.pace_s_per_km },
    });
    render(); updateAll();
    if (state.segments.length === 1) {
      map.fitBounds(L.latLngBounds(coords), { padding: [60, 60] });
    }
  }

  // ---- Personal time estimate --------------------------------------------------
  // Per segment: a trail segment uses that run's real pace; anything else uses
  // the user's median pace. Then a light grade adjustment adds time per meter
  // of climb — on snapped segments only, since a run's recorded pace already
  // includes the hills it was run on.
  function updateTimeEstimate() {
    const el = document.getElementById('stat-esttime');
    const base = medianPaceSPerKm();
    if (!state.segments.length || base == null) { el.textContent = '–'; return; }

    let sec = 0;
    for (const seg of state.segments) {
      const pace = (seg.profile === 'trail' && seg.meta && isFinite(seg.meta.pace_s_per_km))
        ? seg.meta.pace_s_per_km : base;
      sec += (seg.distance / 1000) * pace;
    }

    const perMeter = CFG.trails.hillSecondsPerMeterAscent;
    if (perMeter > 0 && elevSamples.length > 1) {
      // Map elevation samples (distance-from-start along the geometry) onto
      // segment ranges so climb on trail segments can be excluded.
      let acc = 0;
      const ranges = state.segments.map((s) => {
        const len = pathLength(s.coords);
        const r = { start: acc, end: acc + len, trail: s.profile === 'trail' };
        acc = r.end;
        return r;
      });
      for (let i = 1; i < elevSamples.length; i++) {
        const climb = elevSamples[i].ele - elevSamples[i - 1].ele;
        if (climb <= 0) continue;
        const mid = (elevSamples[i].d + elevSamples[i - 1].d) / 2;
        const rg = ranges.find((r) => mid >= r.start && mid < r.end);
        if (!rg || !rg.trail) sec += climb * perMeter;
      }
    }
    el.textContent = fmtDuration(sec);
  }

  // ---- Wiring -------------------------------------------------------------------
  document.getElementById('btn-trails').addEventListener('click', () => {
    trailsPanel.hidden = !trailsPanel.hidden;
  });
  document.getElementById('tp-close').addEventListener('click', () => {
    trailsPanel.hidden = true;
  });
  document.getElementById('btn-load-trails').addEventListener('click', () =>
    document.getElementById('trails-file').click());
  document.getElementById('trails-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { importTrailData(JSON.parse(reader.result)); }
      catch (err) { toast('Not valid JSON: ' + err.message); }
    };
    reader.readAsText(file);
  });
  document.getElementById('tp-showall').addEventListener('change', renderTrailsLayer);

  // Dev convenience: if a trails file is served next to the app (local folder;
  // gitignored so it never reaches the public site), import it automatically
  // for the current user the first time.
  async function tryAutoLoadTrails() {
    if (trailData || !CFG.trails.autoLoadFile) return;
    try {
      const res = await fetch(CFG.trails.autoLoadFile, { cache: 'no-store' });
      if (!res.ok) return; // 404 on the public site — expected
      const json = await res.json();
      if (importTrailData(json)) trailsPanel.hidden = false;
    } catch (e) { /* offline or absent — fine */ }
  }

  renderUserSelect();
  loadTrailData();
  tryAutoLoadTrails();

  // --------------------------------------------------------------------------
  // Toolbar wiring
  // --------------------------------------------------------------------------
  const profileWrap = document.getElementById('profile-buttons');
  for (const p of CFG.profiles) {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.dataset.key = p.key;
    b.title = `Route new segments as: ${p.label}`;
    b.addEventListener('click', () => {
      state.currentProfile = p.key;
      [...profileWrap.children].forEach((c) => {
        const sel = c.dataset.key === p.key;
        c.classList.toggle('selected', sel);
        c.style.background = sel ? profileColor(c.dataset.key) : '';
      });
    });
    profileWrap.appendChild(b);
  }
  profileWrap.children[0].click();

  map.on('click', (e) => {
    if (drawMode) return; // draw mode places points via strokes instead
    enqueue(() => addWaypoint(e.latlng));
  });

  document.getElementById('btn-undo').addEventListener('click', () => enqueue(undo));
  document.getElementById('btn-redo').addEventListener('click', () => enqueue(redo));
  document.getElementById('btn-outback').addEventListener('click', () => enqueue(outAndBack));
  document.getElementById('btn-loop').addEventListener('click', () => enqueue(closeLoop));
  document.getElementById('btn-clear').addEventListener('click', () => enqueue(clearRoute));
  document.getElementById('btn-export').addEventListener('click', exportGPX);
  document.getElementById('btn-import').addEventListener('click', () =>
    document.getElementById('gpx-file').click());
  document.getElementById('gpx-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importGPX(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('search-box').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const q = e.target.value.trim();
    if (!q) return;
    try {
      const res = await fetch(`${CFG.geocoder.url}?q=${encodeURIComponent(q)}&format=json&limit=1`);
      const results = await res.json();
      if (!results.length) { toast('No results for "' + q + '"'); return; }
      map.setView([parseFloat(results[0].lat), parseFloat(results[0].lon)], 15);
    } catch (err) {
      toast('Search failed: ' + err.message);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); enqueue(undo); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); enqueue(redo); }
    else if (e.key.toLowerCase() === 'd') setDrawMode(!drawMode);
    else if (e.key.toLowerCase() === 't') trailsPanel.hidden = !trailsPanel.hidden;
  });

  // --------------------------------------------------------------------------
  // Toast
  // --------------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  // --------------------------------------------------------------------------
  // Programmatic API (handy for testing & scripting)
  // --------------------------------------------------------------------------
  window.FootpathApp = {
    state,
    map,
    addPoint: (lat, lng) => enqueue(() => addWaypoint(L.latLng(lat, lng))),
    undo: () => enqueue(undo),
    redo: () => enqueue(redo),
    clear: () => enqueue(clearRoute),
    outAndBack: () => enqueue(outAndBack),
    closeLoop: () => enqueue(closeLoop),
    setProfile: (key) => { state.currentProfile = key; },
    getDistanceMeters: totalDistance,
    getElevationSamples: () => elevSamples,
    whenIdle: () => opQueue,
    // My Trails / user API
    importTrails: (json) => importTrailData(json),
    getTrailData: () => trailData,
    addTrailById: (id) => {
      const run = trailData && trailData.runs.find((r) => String(r.id) === String(id));
      if (!run) throw new Error('no such run: ' + id);
      return enqueue(() => addTrailToRoute(run));
    },
    getUsers: () => JSON.parse(JSON.stringify(users)),
    getEstimateText: () => document.getElementById('stat-esttime').textContent,
  };

  updateAll();
})();
