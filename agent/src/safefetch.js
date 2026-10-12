// Fetching image URLs that came from strangers (HTTP callers, onchain
// validation requests) on the operator's own machine: refuse anything that
// resolves to a private, loopback or link-local address (SSRF into the home
// network), follow at most 3 redirects with the same check, cap size and time.
// The check runs at connect time, on the address actually dialled, so a DNS
// answer that changes between check and connect (rebinding) cannot slip past.
import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";
import { Agent, fetch } from "undici";

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

const blocked = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
  ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001:db8::", 32], ["2002::", 16]]) blocked.addSubnet(net, bits, "ipv6");

/** the IPv4 inside an IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1) or -compatible IPv6 address */
function embeddedV4(ip) {
  const m = ip.toLowerCase().match(/^::(ffff:)?(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (!m) return null;
  if (m[2]) return m[2];
  const hi = parseInt(m[3], 16), lo = parseInt(m[4], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

export function isPrivateAddress(ip) {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) { const v4 = embeddedV4(ip); return v4 ? blocked.check(v4, "ipv4") : blocked.check(ip, "ipv6"); }
  return true; // not an IP at all: refuse
}

export async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  for (const { address } of addrs) if (isPrivateAddress(address)) throw new Error(`refusing private address ${address}`);
}

/** dns.lookup that refuses private answers; used by the connection itself */
export function guardedLookup(hostname, options, cb) {
  dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const bad = addrs.find((a) => isPrivateAddress(a.address));
    if (bad) return cb(new Error(`refusing private address ${bad.address}`));
    return options.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family);
  });
}
const guardedAgent = new Agent({ connect: { lookup: guardedLookup } });

/** ipfs://CID/path -> https gateway URL */
export function normalizeUrl(u) {
  if (u.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${u.slice(7).replace(/^ipfs\//, "")}`;
  return u;
}

export async function fetchImageBytes(rawUrl, { allowPrivate = false, skipPrecheck = false } = {}) {
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
    // precheck gives a clear error for IP literals (connect skips lookup for those);
    // the guarded dispatcher is the real gate for names
    if (!allowPrivate && !skipPrecheck) await assertPublicHost(u.hostname);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(u, {
        redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "Nadeye-Agent/1.0", accept: "image/*" },
        ...(allowPrivate ? {} : { dispatcher: guardedAgent }),
      });
    } catch (e) {
      const why = e?.cause?.message || "";
      if (/refusing private address/.test(why)) throw new Error(why);
      throw e;
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
