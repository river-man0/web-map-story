/**
 * Two relays sharing one Worker:
 *
 * 1. WebSocket relay for aisstream.io (live AIS vessel data). aisstream.io
 *    does not accept WebSocket connections directly from a browser (there
 *    is no backend for a static GitHub Pages site to hold the API key
 *    server-side), so this sits in between:
 *
 *      browser --(wss, no key)--> this Worker --(wss, key injected)--> aisstream.io
 *
 *    The browser sends a subscription message (bounding box / filters, no
 *    API key). This Worker waits for that message, injects the API key
 *    from a Worker secret, opens the upstream connection to aisstream.io,
 *    and relays messages in both directions verbatim.
 *
 * 2. REST CORS relay for OpenSky Network (live flight data), at the
 *    `/flights` path. OpenSky's API only sends an
 *    Access-Control-Allow-Origin for its own domain, so a browser fetch()
 *    from this site would be blocked by CORS even though the request
 *    itself would succeed. This forwards the request server-side (where
 *    CORS doesn't apply) and adds a permissive CORS header to the
 *    response. It also transparently upgrades to OpenSky's OAuth2 tier
 *    (4,000 requests/day instead of 400) when OPENSKY_CLIENT_ID and
 *    OPENSKY_CLIENT_SECRET secrets are configured, falling back to
 *    anonymous access otherwise.
 */

const AISSTREAM_URL = 'https://stream.aisstream.io/v0/stream';
const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';
const OPENSKY_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/flights') {
      return handleFlightsRequest(request, url, env);
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade request', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    handleClientSocket(server, env).catch((err) => {
      console.error('ais-proxy error', err);
      try {
        server.close(1011, 'Internal error');
      } catch {
        // socket may already be closed
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  },
};

// ---------------------------------------------------------------------------
// OpenSky flight tracking (REST CORS relay + optional OAuth2 upgrade)
// ---------------------------------------------------------------------------

// Module-level cache: Workers reuse the same isolate across requests while
// it's warm, so this avoids re-authenticating on every single poll.
let cachedToken = null;
let tokenExpiresAt = 0;

async function getOpenSkyToken(env) {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) {
    return null; // anonymous fallback
  }
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  const resp = await fetch(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.OPENSKY_CLIENT_ID,
      client_secret: env.OPENSKY_CLIENT_SECRET,
    }),
  });
  if (!resp.ok) {
    console.error('OpenSky auth failed', resp.status, await resp.text());
    return null; // fall back to anonymous rather than failing the request
  }
  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000; // refresh 60s early
  return cachedToken;
}

async function handleFlightsRequest(request, url, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const upstream = new URL(OPENSKY_STATES_URL);
  for (const key of ['lamin', 'lomin', 'lamax', 'lomax']) {
    const value = url.searchParams.get(key);
    if (value !== null) upstream.searchParams.set(key, value);
  }

  const headers = {};
  const token = await getOpenSkyToken(env);
  if (token) headers.Authorization = `Bearer ${token}`;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstream, { headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Could not reach OpenSky: ' + String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const body = await upstreamResponse.text();
  return new Response(body, {
    status: upstreamResponse.status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function handleClientSocket(server, env) {
  let upstream = null;

  const onClientMessage = async (event) => {
    if (upstream) return; // only the first message establishes the subscription

    let subscription;
    try {
      subscription = JSON.parse(event.data);
    } catch {
      server.close(1003, 'Subscription must be JSON');
      return;
    }
    subscription.APIKey = env.AISSTREAM_API_KEY;

    const upstreamResponse = await fetch(AISSTREAM_URL, {
      headers: { Upgrade: 'websocket' },
    });
    upstream = upstreamResponse.webSocket;
    if (!upstream) {
      server.close(1011, 'Could not reach aisstream.io');
      return;
    }
    upstream.accept();
    upstream.send(JSON.stringify(subscription));

    upstream.addEventListener('message', async (upstreamEvent) => {
      // aisstream.io sends text JSON, but the outbound-fetch-based WebSocket
      // client in Workers can deliver `data` as a Blob-like object rather
      // than a plain string. Passing that straight to send() would coerce
      // it to the literal string "[object Blob]" instead of the payload, so
      // normalize every possible shape to text first.
      const data = upstreamEvent.data;
      let text;
      if (typeof data === 'string') {
        text = data;
      } else if (data instanceof ArrayBuffer) {
        text = new TextDecoder().decode(data);
      } else if (typeof data?.text === 'function') {
        text = await data.text();
      } else {
        return;
      }
      server.send(text);
    });
    upstream.addEventListener('close', (closeEvent) => {
      server.close(closeEvent.code, closeEvent.reason);
    });
    upstream.addEventListener('error', () => {
      server.close(1011, 'Upstream connection error');
    });
  };

  server.addEventListener('message', (event) => {
    onClientMessage(event).catch((err) => {
      console.error('ais-proxy subscription error', err);
      server.close(1011, 'Failed to establish upstream subscription');
    });
  });

  server.addEventListener('close', () => {
    if (upstream) upstream.close();
  });
}
