import test from "node:test";
import assert from "node:assert/strict";
import { fetchImageBytes, assertPublicHost, normalizeUrl } from "../src/safefetch.js";

test("refuses private, loopback and link-local targets", async () => {
  for (const u of ["http://127.0.0.1/x.png", "http://10.0.0.5/x", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://localhost/"]) {
    await assert.rejects(fetchImageBytes(u), /refusing private address/, u);
  }
  await assert.rejects(assertPublicHost("172.16.0.1"), /refusing/);
});

test("rejects non-http schemes and decodes data: URLs", async () => {
  await assert.rejects(fetchImageBytes("file:///etc/passwd"), /unsupported URL scheme/);
  const buf = await fetchImageBytes("data:image/png;base64," + Buffer.from("hello").toString("base64"));
  assert.equal(buf.toString(), "hello");
  assert.equal(normalizeUrl("ipfs://bafyCID/img.png"), "https://ipfs.io/ipfs/bafyCID/img.png");
});

test("refuses every private form, including hex-mapped and NAT64 IPv6", async () => {
  const { isPrivateAddress } = await import("../src/safefetch.js");
  for (const ip of ["::ffff:7f00:1", "::ffff:127.0.0.1", "::7f00:1", "64:ff9b::a00:1", "fec0::1", "198.18.0.1", "100.64.0.1", "0.0.0.0", "ff02::1", "2002:c0a8:101::1"]) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ["93.184.216.34", "2606:4700:4700::1111", "::ffff:5db8:d822"]) assert.ok(!isPrivateAddress(ip), ip);
});

test("the connect-time guard blocks a name that resolves privately, even past the precheck (DNS rebinding)", async () => {
  const http = await import("node:http");
  const srv = http.createServer((q, r) => { r.writeHead(200, { "content-type": "image/png" }); r.end("secret"); });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  try {
    // skipPrecheck simulates DNS answering "public" at check time: the connection itself must still refuse
    await assert.rejects(fetchImageBytes(`http://localhost:${port}/x.png`, { skipPrecheck: true }), /refusing private address/);
    // the test-only escape hatch still reaches it, so the server above was really up
    assert.equal((await fetchImageBytes(`http://localhost:${port}/x.png`, { allowPrivate: true })).toString(), "secret");
  } finally {
    srv.close();
  }
});
