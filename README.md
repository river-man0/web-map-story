# Arctic Web Map

An interactive Arctic web map built with [OpenLayers](https://openlayers.org/), rendered
in **EPSG:3573** ("WGS 84 / North Pole LAEA Canada") — a Lambert Azimuthal Equal-Area
projection centred on the North Pole.

## Features

- **EPSG:3573 projection** — the basemap, served natively in unprojected EPSG:4326, is
  reprojected on the fly by OpenLayers/proj4, so no custom tile server is required.
- **True pole-to-pole basemap coverage.** Web-Mercator-based basemaps (EPSG:3857, e.g.
  standard OSM/CARTO tiles) are mathematically undefined above ~85° latitude and leave a
  hole at the pole when reprojected into a polar projection. This map instead uses NASA
  GIBS' "VIIRS_CityLights_2012" (Black Marble) layer, served natively in geographic
  EPSG:4326, which has genuine full-globe coverage.
- **Dark, professional UI** styled for map-reading, with a subtle polar graticule.
- **Coordinate readout** showing latitude/longitude under the pointer (mouse hover) or
  last tap (touch), rather than a cursor-following tooltip, so it works well on mobile.
- **Dynamic scale bar** that updates automatically as you pan and zoom.
- **Mobile-friendly layout** with touch-sized controls and safe-area-aware spacing.
- Basemap tiles from **NASA GIBS** (public, free WMTS endpoint) — no API key required.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the site with
Vite and publishes `dist/` to GitHub Pages via the official
`actions/configure-pages` / `actions/deploy-pages` actions.

To enable it on a repository for the first time, go to **Settings → Pages** and set
**Source** to **GitHub Actions**.

The site is served from `/web-map-story/`, configured via `base` in `vite.config.js` to
match this repository's GitHub Pages project URL.

## Attribution

- Imagery: NASA [GIBS](https://earthdata.nasa.gov/gibs) / Suomi NPP VIIRS "Black Marble"
  (`VIIRS_CityLights_2012`)
- Map library: [OpenLayers](https://openlayers.org/)
