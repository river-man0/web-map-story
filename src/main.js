import 'ol/ol.css';
import './style.css';

import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import WMTS from 'ol/source/WMTS';
import WMTSTileGrid from 'ol/tilegrid/WMTS';
import Graticule from 'ol/layer/Graticule';
import Stroke from 'ol/style/Stroke';
import { defaults as defaultControls, ScaleLine } from 'ol/control';
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
  zoom: 2,
  minZoom: 0,
  maxZoom: RESOLUTIONS.length - 1,
  resolutions: RESOLUTIONS,
});

const scaleLine = new ScaleLine({
  units: 'metric',
  minWidth: 90,
});

const map = new Map({
  target: 'map',
  layers: [basemap, graticule],
  view,
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
  view.animate({ center: [0, 0], zoom: 2, duration: 400 });
});
