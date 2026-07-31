# AIS + flight proxy (Cloudflare Worker)

This Worker relays two live-traffic feeds for the site, both of which have CORS/backend
requirements a static GitHub Pages site can't satisfy on its own:

1. **AIS vessels** (aisstream.io): its WebSocket API doesn't accept connections directly
   from a browser page, and the API key can't be shipped in the site's public JS bundle.

   ```
   browser  --(wss, no key)-->  this Worker  --(wss, key injected)-->  aisstream.io
   ```

   The browser sends a subscription message (bounding box, filters) with no API key. The
   Worker waits for that message, adds the API key from a Worker secret, opens the
   upstream connection to aisstream.io, and relays messages verbatim in both directions
   after that.

2. **Flights** (OpenSky Network), at the `/flights` path: OpenSky's REST API only sends
   an `Access-Control-Allow-Origin` for its own domain, so a direct browser `fetch()` is
   blocked by CORS even though the request itself would succeed. The Worker forwards the
   request server-side and adds a permissive CORS header to the response. It also
   transparently upgrades to OpenSky's free OAuth2 tier (4,000 requests/day instead of
   400) when configured — see step 6 below — falling back to anonymous access otherwise.

## One-time setup

1. **Get an aisstream.io API key**: sign in at [aisstream.io](https://aisstream.io) via
   GitHub and generate a key on the API Keys page. It's free.

2. **Create a Cloudflare account** if you don't have one (free tier is enough):
   https://dash.cloudflare.com/sign-up

3. From this directory, install dependencies and log in:

   ```bash
   cd ais-proxy
   npm install
   npx wrangler login
   ```

4. Set the API key as a Worker secret (you'll be prompted to paste it — it is never
   written to a file or committed):

   ```bash
   npx wrangler secret put AISSTREAM_API_KEY
   ```

5. Deploy:

   ```bash
   npm run deploy
   ```

   Wrangler prints the Worker's URL, something like:

   ```
   https://web-map-story-ais-proxy.<your-subdomain>.workers.dev
   ```

6. **Optional: register a free OpenSky account for a better flight-tracking rate limit.**
   Flight tracking works immediately with no setup (anonymous access, 400 requests/day).
   To raise that to 4,000/day:

   - Sign up for a free account at [opensky-network.org](https://opensky-network.org).
   - Go to your account page and create an API client to get a **Client ID** and
     **Client Secret**.
   - Add both as Worker secrets:

     ```bash
     npx wrangler secret put OPENSKY_CLIENT_ID
     npx wrangler secret put OPENSKY_CLIENT_SECRET
     ```

   - Redeploy (`npm run deploy`).

   (If you deployed via the Cloudflare dashboard's Quick Edit instead of Wrangler CLI,
   add these the same way you added `AISSTREAM_API_KEY`: **Settings → Variables and
   Secrets → Add** on the Worker's page, marked as Secret, then Deploy.)

## Wire it up to the site

The main site reads the proxy URL from the `VITE_AIS_PROXY_URL` build-time environment
variable (see `src/main.js`). Convert the `https://` URL above to `wss://` and set it as
a **repository variable** (not a secret — this URL isn't sensitive) in the main repo:

**Settings → Secrets and variables → Actions → Variables → New repository variable**

- Name: `AIS_PROXY_URL`
- Value: `wss://web-map-story-ais-proxy.<your-subdomain>.workers.dev`

The deploy workflow (`.github/workflows/deploy.yml`) picks it up automatically on the
next push to `main`. For local development, put the same value in a `.env` file at the
repo root (see `.env.example`).

The same variable also drives flight tracking — the site derives the `/flights` URL from
it client-side (swapping `wss://` for `https://`), so there's nothing extra to configure.

## Notes

- The free Cloudflare Workers tier comfortably covers this use case (WebSocket
  connections don't count against the request-based free tier limits the same way HTTP
  requests do, and the flight poll is a lightweight periodic HTTP request; see
  Cloudflare's current Workers pricing for specifics).
- This Worker only relays traffic — it does not store, log, or modify AIS or flight data
  (aside from injecting the AIS API key into the outbound subscription message, and an
  OAuth2 bearer token into outbound OpenSky requests if configured).
