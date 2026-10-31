import { createServer } from "node:http";

const upstream = process.env.SCOIN_NODE_API_URL ?? "http://127.0.0.1:1317";
const port = Number(process.env.SCOIN_PROXY_PORT ?? 8787);
const allowedOrigins = new Set([
  "http://localhost:8081",
  "http://127.0.0.1:8081",
]);
const allowedPaths = [
  /^\/cosmos\/base\/tendermint\/v1beta1\/(?:node_info|syncing|blocks\/latest)$/,
  /^\/cosmos\/staking\/v1beta1\/validators$/,
  /^\/cosmos\/bank\/v1beta1\/balances\/scoin1[023456789acdefghjklmnpqrstuvwxyz]+$/,
  /^\/cosmos\/tx\/v1beta1\/txs$/,
];

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }

  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) {
      response.writeHead(403).end("Origin is not allowed");
      return;
    }
    response.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept",
      "Access-Control-Max-Age": "600",
    }).end();
    return;
  }

  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET, OPTIONS" }).end("Only GET is allowed");
    return;
  }

  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  if (!allowedPaths.some((pattern) => pattern.test(requestUrl.pathname))) {
    response.writeHead(404).end("API route is not available through this proxy");
    return;
  }

  try {
    const nodeResponse = await fetch(
      new URL(`${requestUrl.pathname}${requestUrl.search}`, upstream),
      { headers: { Accept: "application/json" } },
    );
    const body = await nodeResponse.arrayBuffer();
    response.writeHead(nodeResponse.status, {
      "Content-Type": nodeResponse.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    });
    response.end(Buffer.from(body));
  } catch (error) {
    console.error("S Coin node API proxy request failed:", error);
    response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Could not reach the configured S Coin node API");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `S Coin local API proxy listening on http://127.0.0.1:${port} -> ${upstream}`,
  );
});
