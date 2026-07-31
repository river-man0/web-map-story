# AIS proxy (Cloudflare Worker)

aisstream.io's WebSocket API doesn't accept connections directly from a browser page,
and the API key can't be shipped in the site's public JS bundle. This Worker is a thin
relay that sits in between and holds the key server-side:

```
browser  --(wss, no key)-->  this Worker  --(wss, key injected)-->  aisstream.io
```

The browser sends a subscription message (bounding box, filters) with no API key. The
Worker waits for that message, adds the API key from a Worker secret, opens the upstream
connection to aisstream.io, and relays messages verbatim in both directions after that.

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

## Notes

- The free Cloudflare Workers tier comfortably covers this use case (WebSocket
  connections don't count against the request-based free tier limits the same way HTTP
  requests do; see Cloudflare's current Workers pricing for specifics).
- This Worker only relays traffic — it does not store, log, or modify AIS data (aside
  from injecting the API key into the outbound subscription message).
