// Fetching image URLs that came from strangers (HTTP callers, onchain
// validation requests) on the operator's own machine: refuse anything that
// resolves to a private, loopback or link-local address (SSRF into the home
// network), follow at most 3 redirects with the same check, cap size and time.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

function privateV4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function privateV6(ip) {
  const x = ip.toLowerCase();
  if (x === "::1" || x === "::") return true;
  if (x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80")) return true;
  const m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return m ? privateV4(m[1]) : false;
}

export async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  for (const { address, family } of addrs) {
    if (family === 4 ? privateV4(address) : privateV6(address)) throw new Error(`refusing private address ${address}`);
  }
}

/** ipfs://CID/path -> https gateway URL */
export function normalizeUrl(u) {
  if (u.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${u.slice(7).replace(/^ipfs\//, "")}`;
  return u;
}

export async function fetchImageBytes(rawUrl, { allowPrivate = false } = {}) {
  let url = normalizeUrl(String(rawUrl).trim());
  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
    if (!m) throw new Error("bad data: URL");
    const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
    if (buf.length > MAX_BYTES) throw new Error("image too large");
    return buf;
  }
  for (let hop = 0; hop <= 3; hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`unsupported URL scheme ${u.protocol}`);
    if (!allowPrivate) await assertPublicHost(u.hostname);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(u, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "Nadeye-Agent/1.0", accept: "image/*" } });
    } finally {
      clearTimeout(t);
    }
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
      url = new URL(resp.headers.get("location"), u).toString();
      continue;
    }
    if (!resp.ok) throw new Error(`fetch failed: HTTP ${resp.status}`);
    const len = Number(resp.headers.get("content-length") || 0);
    if (len > MAX_BYTES) throw new Error("image too large");
    const chunks = [];
    let total = 0;
    for await (const c of resp.body) {
      total += c.length;
      if (total > MAX_BYTES) throw new Error("image too large");
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("too many redirects");
}
