// MCP server: lets any MCP-capable AI agent (Claude Desktop, Claude Code,
// Cursor, …) check an image before it trusts, reposts or acts on it.
// stdio for local clients; stateless streamable HTTP at POST /mcp for remote ones.
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const asError = (e) => ({ isError: true, content: [{ type: "text", text: String(e?.message || e) }] });

export function buildMcpServer({ verifier, chain, allowFiles }) {
  const server = new McpServer({ name: "nadeye", version: "1.0.0" });

  server.registerTool("verify_image", {
    title: "Check if an image is AI-generated",
    description:
      "Runs Nadeye's local AI-image detector on an image URL (https, ipfs:// or data:) and merges the onchain community verdict " +
      "recorded on Monad for the same picture. Returns verdict (ai | real | unsure), aiConfidence 0-1 (flagged at 0.65; recorded onchain as an AI vote at 0.80+, a real vote below 0.50), " +
      "the image's perceptual hash and how many Nadeye scanners flagged it.",
    inputSchema: { url: z.string().describe("Image URL: https://…, ipfs://… or data:image/…") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    try { return asText(await verifier.verifyUrl(url)); } catch (e) { return asError(e); }
  });

  if (allowFiles) {
    server.registerTool("verify_image_file", {
      title: "Check a local image file",
      description: "Same as verify_image for a file on this computer (absolute path).",
      inputSchema: { path: z.string().describe("Absolute path to a JPEG, PNG, WebP, GIF or AVIF file") },
      annotations: { readOnlyHint: true },
    }, async ({ path }) => {
      try { return asText(await verifier.verifyBytes(await readFile(path), { source: path })); } catch (e) { return asError(e); }
    });
  }

  server.registerTool("lookup_phash", {
    title: "Look up a perceptual hash in the Nadeye registry",
    description: "Returns the community verdict stored on Monad for a 16-hex-character Nadeye pHash, without downloading any image.",
    inputSchema: { pHash: z.string().regex(/^[0-9a-fA-F]{16}$/).describe("16 hex characters") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ pHash }) => {
    try { return asText({ pHash, community: await chain.community([pHash.toLowerCase()]) }); } catch (e) { return asError(e); }
  });

  return server;
}

export async function runStdio(deps) {
  const server = buildMcpServer({ ...deps, allowFiles: true });
  await server.connect(new StdioServerTransport());
}

/** stateless streamable-HTTP handler mounted at /mcp (no local file access) */
export function httpMcpHandler(deps) {
  return async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json", allow: "POST" });
      res.end(JSON.stringify({ error: "MCP endpoint: POST JSON-RPC" }));
      return;
    }
    const server = buildMcpServer({ ...deps, allowFiles: false });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };
}
