// ERC-8004 agent registration file for the Nadeye verifier.
export function agentCard(cfg, { agentId = null, publicUrl = null, mcp = true } = {}) {
  const services = [];
  if (publicUrl) {
    services.push({ name: "web", endpoint: publicUrl.replace(/\/$/, "") + "/verify" });
    if (mcp) services.push({ name: "MCP", endpoint: publicUrl.replace(/\/$/, "") + "/mcp", version: "2025-06-18" });
  }
  services.push({ name: "agentWallet", endpoint: `eip155:${cfg.chain.id}:${cfg.walletAddress || "unknown"}` });
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Nadeye Verifier",
    description:
      "Checks whether an image is AI-generated. Runs Sieve's on-device detector (ViT-S/16, 91% balanced accuracy on its held-out benchmark) " +
      "and merges the onchain Nadeye community verdict for the image's perceptual hash. " +
      `Send an ERC-8004 validationRequest to this agent's wallet with requestURI = the image URL (https, ipfs or data:). ` +
      `Response = authenticity 0-100 (100 = no sign of AI generation, 0 = AI-generated), tag "nadeye/ai-image", ` +
      "responseURI = JSON report (verdict, aiConfidence, pHash, community counts, model version).",
    services,
    x402Support: false,
    active: true,
    registrations: agentId == null ? [] : [{ agentId: Number(agentId), agentRegistry: `eip155:${cfg.chain.id}:${cfg.identity}` }],
    supportedTrust: ["reputation", "validation"],
    nadeye: { contract: cfg.contract, network: cfg.network },
  };
}

export const toDataUri = (obj) => "data:application/json;base64," + Buffer.from(JSON.stringify(obj)).toString("base64");
