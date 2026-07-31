import 'ol/ol.css';
import './style.css';

import OlMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import WMTS from 'ol/source/WMTS';
import WMTSTileGrid from 'ol/tilegrid/WMTS';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Graticule from 'ol/layer/Graticule';
import { Style, Stroke, Fill, RegularShape, Circle as CircleStyle } from 'ol/style';
import { defaults as defaultControls, ScaleLine } from 'ol/control';
import Overlay from 'ol/Overlay';
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';
import { get as getProjection, transform } from 'ol/proj';

// ---------------------------------------------------------------------------
// Projection: EPSG:3573 "WGS 84 / North Pole LAEA Canada"
// A Lambert Azimuthal Equal-Area projection centred on the North Pole,
// well suited to Arctic-focused mapping (valid north of ~45degN).
// ---------------------------------------------------------------------------
proj4.defs(
  'EPSG:3573',
  '+proj=laea +lat_0=90 +lon_0=-100 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'
);
register(proj4);

const projection3573 = getProjection('EPSG:3573');
// Conservative square extent covering the projection's area of use
// (world extent below), used by OpenLayers to clip/tile reprojected data.
const HALF_EXTENT = 5_500_000;
projection3573.setExtent([-HALF_EXTENT, -HALF_EXTENT, HALF_EXTENT, HALF_EXTENT]);
projection3573.setWorldExtent([-180, 45, 180, 90]);

// Fixed resolution ladder (metres/pixel) so tiling stays predictable while
// the basemap is reprojected on the fly into EPSG:3573. Capped at 128 m/px,
// close to the basemap's native ~500 m resolution, to avoid zooming into blur.
const RESOLUTIONS = [16384, 8192, 4096, 2048, 1024, 512, 256, 128];

// ---------------------------------------------------------------------------
// Basemap - NASA GIBS "VIIRS_CityLights_2012" (Black Marble), a free public
// WMTS endpoint served natively in unprojected EPSG:4326. No API key
// required. Unlike Web-Mercator-based basemaps (EPSG:3857), which are
// mathematically undefined above ~85 deg latitude and leave a hole at the
// pole, this geographic source has genuine pole-to-pole coverage.
// ---------------------------------------------------------------------------
const GIBS_RESOLUTIONS = [
  0.3515625, 0.234375, 0.140625, 0.0703125, 0.03515625, 0.017578125, 0.0087890625, 0.00439453125,
];
const GIBS_MATRIX_IDS = GIBS_RESOLUTIONS.map((_, i) => String(i));

const basemap = new TileLayer({
  source: new WMTS({
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_CityLights_2012/default/500m/{TileMatrix}/{TileRow}/{TileCol}.jpeg',
    layer: 'VIIRS_CityLights_2012',
    matrixSet: '500m',
    format: 'image/jpeg',
    projection: 'EPSG:4326',
    requestEncoding: 'REST',
    style: 'default',
    tileGrid: new WMTSTileGrid({
      origin: [-180, 90],
      resolutions: GIBS_RESOLUTIONS,
      matrixIds: GIBS_MATRIX_IDS,
      tileSize: 512,
    }),
    attributions: [
      'Imagery: NASA <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">GIBS</a> / Suomi NPP VIIRS "Black Marble"',
    ],
    crossOrigin: 'anonymous',
    wrapX: true,
    // Reprojecting into EPSG:3573 warps every tile via triangulated canvas
    // drawing on the main thread. The default 0.5px error threshold produces
    // a lot of triangles for a coarse satellite basemap; a looser threshold
    // cuts that work down substantially with no visible quality loss here,
    // which matters most on lower-power/mobile browsers.
    reprojectionErrorThreshold: 3,
  }),
});

// A subtle graticule reinforces that this is a polar projection. Labels are
// disabled: OL's Graticule label placement assumes a projection without a
// singularity, and meridian labels overlap into unreadable clutter near the
// pole in an azimuthal projection like this one. The coordinate readout
// panel already gives an exact lat/lon reference, so it's not missed.
const graticule = new Graticule({
  strokeStyle: new Stroke({
    color: 'rgba(148, 163, 184, 0.35)',
    width: 1,
    lineDash: [1, 4],
  }),
  showLabels: false,
  wrapX: false,
  targetSize: 200,
});

const view = new View({
  projection: projection3573,
  center: [0, 0], // the North Pole in EPSG:3573
  // Starting more zoomed out means covering more physical area, which for a
  // reprojected geographic source means stitching + warping many more
  // source tiles for the very first paint. zoom 3 keeps a wide Arctic view
  // while roughly halving that up-front cost versus zoom 2.
  zoom: 3,
  minZoom: 0,
  maxZoom: RESOLUTIONS.length - 1,
  resolutions: RESOLUTIONS,
});

const scaleLine = new ScaleLine({
  units: 'metric',
  minWidth: 90,
});

const map = new OlMap({
  target: 'map',
  layers: [basemap, graticule],
  view,
  // Reprojection cost scales with pixel count, so an uncapped devicePixelRatio
  // (2.5-3+ on many Android phones) makes every tile warp several times more
  // expensive for no visible benefit against a ~500m-resolution satellite
  // basemap. Capping it keeps panning/zooming smooth on lower-power devices.
  pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
  controls: defaultControls({ attribution: true, zoom: true, rotate: false }).extend([scaleLine]),
});

// ---------------------------------------------------------------------------
// Coordinate tooltip - works for mouse hover *and* touch tap, since it
// updates a fixed panel rather than following the pointer around.
// ---------------------------------------------------------------------------
const latEl = document.getElementById('coord-lat');
const lonEl = document.getElementById('coord-lon');
const hintEl = document.getElementById('hint');

function formatCoord(value, positiveSuffix, negativeSuffix) {
  const suffix = value >= 0 ? positiveSuffix : negativeSuffix;
  return `${Math.abs(value).toFixed(4)}° ${suffix}`;
}

function updateCoords(coordinate) {
  const [lon, lat] = transform(coordinate, view.getProjection(), 'EPSG:4326');
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  latEl.textContent = formatCoord(lat, 'N', 'S');
  lonEl.textContent = formatCoord(lon, 'E', 'W');
  if (hintEl) hintEl.hidden = true;
}

map.on('pointermove', (evt) => {
  if (evt.dragging) return;
  updateCoords(evt.coordinate);
});

map.on('click', (evt) => updateCoords(evt.coordinate));

// ---------------------------------------------------------------------------
// Reset view
// ---------------------------------------------------------------------------
document.getElementById('reset-view').addEventListener('click', () => {
  view.animate({ center: [0, 0], zoom: 3, duration: 400 });
});

// ---------------------------------------------------------------------------
// Live AIS vessel traffic - aisstream.io, a free global feed built from
// volunteer terrestrial AIS receivers. Connections go through a small relay
// (see ais-proxy/) because aisstream.io doesn't accept WebSocket connections
// directly from a browser, and the API key can't live in public client code.
//
// Coverage is inherently limited to wherever a receiver exists. There is
// very little receiver infrastructure in the open Arctic Ocean on *any*
// free network - that requires paid satellite AIS - so expect traffic
// mostly near populated Canadian coastlines and Arctic gateway communities
// rather than the high seas.
// ---------------------------------------------------------------------------
const AIS_PROXY_URL = import.meta.env.VITE_AIS_PROXY_URL;

// Two boxes rather than one big one, so we don't have to pull in a huge
// swath of ocean at mid-latitudes just to cover both regions:
const AIS_BOUNDS = [
  // Canada's coastline and Arctic waters: Pacific coast, Great
  // Lakes/St. Lawrence, Atlantic Canada, Hudson Bay, and the Arctic
  // archipelago up to the pole.
  [
    [41, -141],
    [90, -52],
  ],
  // Circumpolar Arctic band (all longitudes): Russia's Arctic coast, Alaska,
  // Greenland, Iceland, and Scandinavia. Coverage still depends on where a
  // receiver actually exists - dense around Scandinavia/Iceland, sparse to
  // nonexistent around Russia's Northern Sea Route and far-north Alaska.
  [
    [55, -180],
    [90, 180],
  ],
];

const VESSEL_STALE_MS = 30 * 60 * 1000; // drop vessels not heard from in 30 min

const NAV_STATUS = {
  0: 'Under way (engine)',
  1: 'At anchor',
  2: 'Not under command',
  3: 'Restricted manoeuvrability',
  4: 'Constrained by draught',
  5: 'Moored',
  6: 'Aground',
  7: 'Fishing',
  8: 'Under way sailing',
};

// A vessel with a valid heading/course is drawn as a triangle rotated to
// point the right way *on screen*. EPSG:3573 is a polar azimuthal
// projection, so meridians radiate as straight lines out of the pole - "true
// north" at any given point on the map is simply the direction back toward
// the map's centre (the pole), not "up". That local bearing is added to the
// vessel's true-north heading to get the correct on-screen rotation.
function bearingTowardPole([x, y]) {
  return (Math.atan2(-x, -y) * 180) / Math.PI;
}

const vesselArrow = new RegularShape({
  points: 3,
  radius: 6,
  fill: new Fill({ color: '#f6b93b' }),
  stroke: new Stroke({ color: 'rgba(10, 14, 20, 0.85)', width: 1 }),
  rotateWithView: true,
});
const vesselArrowStyle = new Style({ image: vesselArrow });

const vesselDotStyle = new Style({
  image: new CircleStyle({
    radius: 4,
    fill: new Fill({ color: '#f6b93b' }),
    stroke: new Stroke({ color: 'rgba(10, 14, 20, 0.85)', width: 1 }),
  }),
});

function vesselStyleFunction(feature) {
  const heading = feature.get('heading');
  const cog = feature.get('cog');
  // 511 (heading) / 360 (cog) are the AIS "not available" sentinel values.
  const trueBearing = heading < 360 ? heading : cog < 360 ? cog : null;

  if (trueBearing === null) {
    return vesselDotStyle;
  }

  const screenBearing = bearingTowardPole(feature.getGeometry().getCoordinates()) + trueBearing;
  vesselArrow.setRotation((screenBearing * Math.PI) / 180);
  return vesselArrowStyle;
}

const vesselSource = new VectorSource({
  attributions: ['AIS: <a href="https://aisstream.io" target="_blank" rel="noopener">aisstream.io</a>'],
});

const vesselLayer = new VectorLayer({
  source: vesselSource,
  style: vesselStyleFunction,
});
map.addLayer(vesselLayer);

const aisStatusEl = document.getElementById('ais-status');
const vesselsByMmsi = new Map(); // mmsi -> { feature, lastSeen }

function setAisStatus(text, { enabled } = {}) {
  if (!aisStatusEl) return;
  aisStatusEl.textContent = text;
  if (enabled !== undefined) aisStatusEl.disabled = !enabled;
}

function updateVesselCount() {
  setAisStatus(`AIS · ${vesselsByMmsi.size.toLocaleString()}`, { enabled: vesselsByMmsi.size > 0 });
}

function pruneStaleVessels() {
  const cutoff = Date.now() - VESSEL_STALE_MS;
  for (const [mmsi, entry] of vesselsByMmsi) {
    if (entry.lastSeen < cutoff) {
      vesselSource.removeFeature(entry.feature);
      vesselsByMmsi.delete(mmsi);
    }
  }
  updateVesselCount();
}
setInterval(pruneStaleVessels, 60_000);

function handlePositionReport(report) {
  const mmsi = report.UserID;
  const lon = report.Longitude;
  const lat = report.Latitude;
  if (!Number.isFinite(mmsi) || !Number.isFinite(lon) || !Number.isFinite(lat)) return;

  const coordinate = transform([lon, lat], 'EPSG:4326', view.getProjection());
  let entry = vesselsByMmsi.get(mmsi);

  if (!entry) {
    const feature = new Feature({ geometry: new Point(coordinate) });
    feature.set('mmsi', mmsi);
    entry = { feature, lastSeen: 0 };
    vesselsByMmsi.set(mmsi, entry);
    vesselSource.addFeature(feature);
  } else {
    entry.feature.getGeometry().setCoordinates(coordinate);
  }

  entry.feature.set('sog', report.Sog);
  entry.feature.set('cog', report.Cog);
  entry.feature.set('heading', report.TrueHeading);
  entry.feature.set('navStat', report.NavigationalStatus);
  entry.lastSeen = Date.now();
  entry.feature.set('updatedAt', entry.lastSeen);

  updateVesselCount();
}

let aisReconnectDelay = 2000;

function connectAis() {
  if (!AIS_PROXY_URL) {
    setAisStatus('AIS not configured', { enabled: false });
    return;
  }

  setAisStatus('AIS · connecting…', { enabled: false });
  const socket = new WebSocket(AIS_PROXY_URL);

  socket.addEventListener('open', () => {
    aisReconnectDelay = 2000;
    socket.send(
      JSON.stringify({
        BoundingBoxes: AIS_BOUNDS,
        FilterMessageTypes: ['PositionReport'],
      }),
    );
    updateVesselCount();
  });

  socket.addEventListener('message', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (payload.error) {
      console.error('AIS stream error', payload.error);
      setAisStatus('AIS unavailable', { enabled: false });
      return;
    }
    if (payload.MessageType === 'PositionReport') {
      handlePositionReport(payload.Message.PositionReport);
    }
  });

  socket.addEventListener('close', () => {
    setAisStatus('AIS · reconnecting…', { enabled: vesselsByMmsi.size > 0 });
    setTimeout(connectAis, aisReconnectDelay);
    aisReconnectDelay = Math.min(aisReconnectDelay * 2, 30_000);
  });

  socket.addEventListener('error', () => socket.close());
}

connectAis();

if (aisStatusEl) {
  aisStatusEl.addEventListener('click', () => {
    const extent = vesselSource.getExtent();
    if (extent.every(Number.isFinite)) {
      view.fit(extent, { padding: [80, 80, 80, 80], duration: 500, maxZoom: 6 });
    }
  });
}

// ---------------------------------------------------------------------------
// Vessel info popup on click/tap
// ---------------------------------------------------------------------------
const popupEl = document.getElementById('vessel-popup');
const popupOverlay = new Overlay({
  element: popupEl,
  positioning: 'bottom-center',
  offset: [0, -12],
  stopEvent: true,
  autoPan: { animation: { duration: 250 } },
});
map.addOverlay(popupOverlay);

function formatAge(timestampMs) {
  if (!timestampMs) return 'unknown';
  const minutes = Math.round((Date.now() - timestampMs) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

function showVesselPopup(feature, coordinate) {
  const mmsi = feature.get('mmsi');
  const sog = feature.get('sog');
  const cog = feature.get('cog');
  const navStat = feature.get('navStat');
  const updated = feature.get('updatedAt');

  popupEl.innerHTML = `
    <button class="popup-close" type="button" aria-label="Close">&times;</button>
    <div class="popup-title">MMSI ${mmsi}</div>
    <div class="popup-row"><span>Status</span><span>${NAV_STATUS[navStat] ?? 'Unknown'}</span></div>
    <div class="popup-row"><span>Speed</span><span>${Number.isFinite(sog) && sog < 102.3 ? `${sog.toFixed(1)} kn` : 'n/a'}</span></div>
    <div class="popup-row"><span>Course</span><span>${Number.isFinite(cog) && cog < 360 ? `${cog.toFixed(0)}°` : 'n/a'}</span></div>
    <div class="popup-row"><span>Updated</span><span>${formatAge(updated)}</span></div>
  `;
  popupEl.querySelector('.popup-close').addEventListener('click', () => popupOverlay.setPosition(undefined));
  popupOverlay.setPosition(coordinate);
}

map.on('singleclick', (evt) => {
  const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f, {
    layerFilter: (l) => l === vesselLayer,
    hitTolerance: 8,
  });
  if (feature) {
    showVesselPopup(feature, evt.coordinate);
  } else {
    popupOverlay.setPosition(undefined);
  }
});
