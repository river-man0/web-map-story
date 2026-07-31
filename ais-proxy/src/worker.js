/**
 * WebSocket relay for aisstream.io.
 *
 * aisstream.io does not accept WebSocket connections directly from a
 * browser (there is no backend for a static GitHub Pages site to hold the
 * API key server-side), so this Worker sits in between:
 *
 *   browser --(wss, no key)--> this Worker --(wss, key injected)--> aisstream.io
 *
 * The browser sends a subscription message (bounding box / filters, no
 * API key). This Worker waits for that message, injects the API key from
 * a Worker secret, opens the upstream connection to aisstream.io, and then
 * relays messages in both directions verbatim.
 */

const AISSTREAM_URL = 'https://stream.aisstream.io/v0/stream';

export default {
  async fetch(request, env) {
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

    upstream.addEventListener('message', (upstreamEvent) => {
      server.send(upstreamEvent.data);
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
