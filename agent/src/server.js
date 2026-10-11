// HTTP API for agents and apps.
//   GET  /verify?url=https://…          -> verdict JSON
//   POST /verify  (image bytes, or JSON {"url": "…"})
//   GET  /health
//   GET  /.well-known/agent-registration.json   (ERC-8004 registration file)
//   POST /mcp     (MCP over streamable HTTP, stateless)
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

export function createApi({ verifier, cfg, mcpHandler = null, publicUrl = null }) {
  const hits = new Map(); // ip -> [timestamps], 60 requests/minute
  const limited = (ip) => {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
    arr.push(now);
    hits.set(ip, arr);
    return arr.length > 60;
  };

  return createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version", "access-control-allow-methods": "GET, POST, OPTIONS" });
      res.end(JSON.stringify(obj, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    };
    try {
      const url = new URL(req.url, "http://local");
      if (req.method === "OPTIONS") return send(204, {});
      if (url.pathname === "/health") return send(200, { ok: true, model: verifier && cfg ? cfg.modelVersion : undefined, network: cfg.network, contract: cfg.contract });
      if (url.pathname === "/.well-known/agent-registration.json" || url.pathname === "/agent-card.json") {
        return send(200, agentCard(cfg, { agentId: cfg.agentId, publicUrl }));
      }
      if (url.pathname === "/mcp" && mcpHandler) return mcpHandler(req, res);
      if (url.pathname !== "/verify") return send(404, { error: "not found", routes: ["/verify", "/health", "/mcp", "/.well-known/agent-registration.json"] });
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
      const code = /too-small|degenerate|refusing|unsupported|bad data|too large|fetch failed|Input buffer|unsupported image/i.test(msg) ? 422 : 500;
      return send(code, { error: msg });
    }
  });
}
