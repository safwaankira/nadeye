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
