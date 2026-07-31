# Arctic Web Map

An interactive Arctic web map built with [OpenLayers](https://openlayers.org/), rendered
in **EPSG:3573** ("WGS 84 / North Pole LAEA Canada") — a Lambert Azimuthal Equal-Area
projection centred on the North Pole.

**Live site:** https://river-man0.github.io/web-map-story/

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
- **Live AIS vessel traffic**, streamed from [aisstream.io](https://aisstream.io), across
  two bounding boxes: Canada's coastline and Arctic waters (Pacific coast, Great
  Lakes/St. Lawrence, Atlantic Canada, Hudson Bay, and the Arctic archipelago up to the
  pole), plus a circumpolar Arctic band spanning all longitudes (~55–90°N) covering
  Russia's Arctic coast, Alaska, Greenland, Iceland, and Scandinavia. Vessels with a valid
  heading/course are drawn as rotated arrows — correctly oriented for a polar azimuthal
  projection, where "true north" at a given point is the direction back toward the pole,
  not "up" on screen. Tap a vessel for its MMSI, status, speed, and course; tap the "AIS"
  badge in the header to fly to the current traffic.

  Coverage depends entirely on where a receiver exists. aisstream.io's network is
  terrestrial (land-based receivers, ~40-70 km range), and there is very little of that
  infrastructure in the open Arctic Ocean on any free service — genuine blue-water Arctic
  coverage requires paid satellite AIS. In practice this means traffic clusters near
  populated coasts and Arctic gateway communities (Scandinavia and Iceland show up well;
  Russia's Northern Sea Route and far-north Alaska stay sparse to empty) rather than the
  high seas.

  aisstream.io doesn't accept WebSocket connections directly from a browser page, and its
  API key can't live in this site's public client code, so the connection goes through a
  small Cloudflare Worker relay — see [`ais-proxy/`](ais-proxy/) for what it does and how
  to deploy your own. Without one configured, the map still works; the AIS badge just
  reads "AIS not configured".

- **Live flight traffic**, polled from the [OpenSky Network](https://opensky-network.org)
  REST API over Canada's coastline and Arctic waters (the same box as the primary AIS
  bounding box). Aircraft with a known heading are drawn as rotated arrows, using the same
  polar-azimuthal "bearing toward the pole" correction as vessels. Tap an aircraft for its
  callsign, country, altitude, speed, heading, and climb/descent rate; tap the "Flights"
  badge in the header to fly to the current traffic.

  Like AIS, OpenSky is routed through the same Cloudflare Worker relay to work around
  CORS — no separate deployment needed. It works out of the box with OpenSky's anonymous
  tier (400 requests/day); see [`ais-proxy/README.md`](ais-proxy/README.md) for how to
  optionally add free OpenSky OAuth2 credentials for a much higher limit (4,000/day).

## Development

```bash
npm install
cp .env.example .env   # fill in VITE_AIS_PROXY_URL once you've deployed ais-proxy/
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

The build step reads `VITE_AIS_PROXY_URL` from the `AIS_PROXY_URL` **repository
variable** (Settings → Secrets and variables → Actions → Variables) — set this once
you've deployed `ais-proxy/` (see below). It's a repo variable, not a secret, because the
Worker URL itself isn't sensitive; the actual API key lives only in the Worker's own
secret store and is never part of this repo or its build output.

## AIS + flight proxy setup

Live AIS vessel traffic and flight traffic both require deploying a small Cloudflare
Worker: AIS holds the aisstream.io API key server-side, and flights work around
OpenSky's CORS restriction. Both share one Worker and one deployment. See
[`ais-proxy/README.md`](ais-proxy/README.md) for the one-time setup. The main map works
fine without it — the badges just show "not configured" — so this is optional.

## Attribution

- Imagery: NASA [GIBS](https://earthdata.nasa.gov/gibs) / Suomi NPP VIIRS "Black Marble"
  (`VIIRS_CityLights_2012`)
- AIS vessel data: [aisstream.io](https://aisstream.io)
- Flight data: [OpenSky Network](https://opensky-network.org)
- Map library: [OpenLayers](https://openlayers.org/)
