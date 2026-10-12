// HTTP API exposure: Host allow-list (DNS rebinding) and Origin allow-list (web pages).
import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createApi } from "../src/server.js";

const verifier = { verifyUrl: async (u) => ({ verdict: "real", source: u }), verifyBytes: async () => ({ verdict: "real" }) };
const cfg = { network: "testnet", chain: { id: 10143 }, contract: null, identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  host: "127.0.0.1", allowedHosts: [], corsOrigins: ["https://nadeye.example"] };

function call(port, { path = "/verify?url=https://example.com/a.png", host, origin, method = "GET" } = {}) {
  return new Promise((ok, fail) => {
    const headers = {};
    if (host) headers.host = host;
    if (origin) headers.origin = origin;
    const r = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => ok({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on("error", fail); r.end();
  });
}

test("HTTP API refuses foreign Host headers and unlisted browser origins", async () => {
  const api = createApi({ verifier, cfg, publicUrl: "https://agent.example.dev" });
  await new Promise((ok) => api.listen(0, "127.0.0.1", ok));
  const port = api.address().port;
  try {
    // server-to-server caller (no Origin) on the loopback Host: allowed, no CORS header
    let r = await call(port, { host: `127.0.0.1:${port}` });
    assert.equal(r.status, 200); assert.equal(r.headers["access-control-allow-origin"], undefined);
    // the tunnel's host name is accepted
    assert.equal((await call(port, { host: "agent.example.dev" })).status, 200);
    // DNS rebinding: a page on evil.example resolved to 127.0.0.1 sends Host: evil.example
    assert.equal((await call(port, { host: "evil.example" })).status, 421);
    // a web page that is not allow-listed cannot drive the agent, even with a good Host
    assert.equal((await call(port, { host: `localhost:${port}`, origin: "https://evil.example" })).status, 403);
    assert.equal((await call(port, { host: `localhost:${port}`, origin: "https://evil.example", path: "/mcp", method: "POST" })).status, 403);
    // an allow-listed origin gets its own origin echoed back, never "*"
    r = await call(port, { host: `localhost:${port}`, origin: "https://nadeye.example" });
    assert.equal(r.status, 200); assert.equal(r.headers["access-control-allow-origin"], "https://nadeye.example");
    // the public agent card stays readable from any origin
    r = await call(port, { host: `localhost:${port}`, origin: "https://evil.example", path: "/.well-known/agent-registration.json" });
    assert.equal(r.status, 200); assert.equal(r.headers["access-control-allow-origin"], "*");
  } finally {
    api.close();
  }
});
