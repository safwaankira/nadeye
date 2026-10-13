// HTTP API for agents and apps.
//   GET  /verify?url=https://…          -> verdict JSON
//   POST /verify  (image bytes, or JSON {"url": "…"})
//   GET  /health
//   GET  /.well-known/agent-registration.json   (ERC-8004 registration file)
//   POST /mcp     (MCP over streamable HTTP, stateless)
//   POST /drip    {"address": "0x…"} -> a little testnet MON for a new account (opt-in, testnet only)
import { createServer } from "node:http";
import { agentCard } from "./card.js";

const MAX_BODY = 25 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Host names this server answers to: loopback, the tunnel's (publicUrl) and any configured.
// Anything else is a DNS-rebinding attempt and is refused.
function hostAllowList(cfg, publicUrl) {
  const hosts = new Set(["127.0.0.1", "localhost", "::1", ...(cfg.allowedHosts || [])]);
  if (cfg.host && !["0.0.0.0", "::"].includes(cfg.host)) hosts.add(cfg.host.toLowerCase());
  if (publicUrl) { try { hosts.add(new URL(publicUrl).hostname.toLowerCase()); } catch {} }
  return hosts;
}
const hostOf = (h = "") => h.toLowerCase().replace(/^\[([^\]]+)\](:\d+)?$/, "$1").replace(/:\d+$/, "");
const PUBLIC_PATHS = new Set(["/health", "/.well-known/agent-registration.json", "/agent-card.json"]);

// Behind a local tunnel every request arrives from loopback, so take the client address from
// the tunnel's header; a request that reaches us directly can't choose its own IP this way.
function clientIp(req) {
  const remote = req.socket.remoteAddress || "?";
  if (!/^(127\.|::1$|::ffff:127\.)/.test(remote)) return remote;
  return String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || remote).split(",")[0].trim();
}

export function createApi({ verifier, cfg, mcpHandler = null, publicUrl = null, drip = null }) {
  const hosts = hostAllowList(cfg, publicUrl);
  const origins = new Set(cfg.corsOrigins || []);
  const hits = new Map(); // ip -> [timestamps], 60 requests/minute
  const limited = (ip) => {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
    arr.push(now);
    hits.set(ip, arr);
    return arr.length > 60;
  };

  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    let cors = {};
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify(obj, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    };
    try {
      const url = new URL(req.url, "http://local");
      if (!hosts.has(hostOf(req.headers.host))) return send(421, { error: "unknown Host; add it to NADEYE_ALLOWED_HOSTS" });
      if (PUBLIC_PATHS.has(url.pathname)) {
        cors = { "access-control-allow-origin": "*" };
      } else if (origin) {
        // a web page in someone's browser: only allow-listed origins may drive the agent
        if (!origins.has(origin)) return send(403, { error: "origin not allowed; add it to NADEYE_CORS_ORIGINS" });
        cors = { "access-control-allow-origin": origin, vary: "origin", "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version", "access-control-allow-methods": "GET, POST, OPTIONS" };
      }
      if (req.method === "OPTIONS") return send(204, {});
      if (url.pathname === "/health") return send(200, { ok: true, model: verifier && cfg ? cfg.modelVersion : undefined, network: cfg.network, contract: cfg.contract });
      if (url.pathname === "/.well-known/agent-registration.json" || url.pathname === "/agent-card.json") {
        return send(200, agentCard(cfg, { agentId: cfg.agentId, publicUrl }));
      }
      if (url.pathname === "/mcp" && mcpHandler) return mcpHandler(req, res);
      if (url.pathname === "/drip" && drip?.enabled) {
        if (req.method !== "POST") return send(405, { error: "use POST with {\"address\": \"0x…\"}" });
        if (limited(clientIp(req))) return send(429, { error: "rate limited: 60 requests per minute" });
        const body = await readBody(req);
        if (body.length > 1024) return send(413, { error: "body too large" });
        let address;
        try { ({ address } = JSON.parse(body.toString("utf8") || "{}")); } catch { return send(400, { error: "Send JSON {\"address\": \"0x…\"}" }); }
        try { return send(200, await drip.request(address, clientIp(req))); }
        catch (e) { return send(e.status || 500, { error: e.status ? e.message : "drip failed" }); }
      }
      if (url.pathname !== "/verify") return send(404, { error: "not found", routes: ["/verify", "/health", "/mcp", "/.well-known/agent-registration.json", ...(drip?.enabled ? ["/drip"] : [])] });
      if (limited(req.socket.remoteAddress || "?")) return send(429, { error: "rate limited: 60 requests per minute" });

      if (req.method === "GET") {
        const target = url.searchParams.get("url");
        if (!target) return send(400, { error: "pass ?url=<image URL>" });
        return send(200, await verifier.verifyUrl(target));
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        const type = req.headers["content-type"] || "";
        if (type.includes("application/json")) {
          const { url: target } = JSON.parse(body.toString("utf8") || "{}");
          if (!target) return send(400, { error: "JSON body needs {\"url\": …}" });
          return send(200, await verifier.verifyUrl(target));
        }
        if (!body.length) return send(400, { error: "send image bytes or JSON {url}" });
        return send(200, await verifier.verifyBytes(body, { source: "upload" }));
      }
      return send(405, { error: "use GET or POST" });
    } catch (e) {
      const msg = String(e?.message || e);
      const code = /too-small|degenerate|refusing|unsupported|bad data|too large|fetch failed|Input buffer|unsupported image|not an image/i.test(msg) ? 422 : 500;
      return send(code, { error: msg });
    }
  });
}
