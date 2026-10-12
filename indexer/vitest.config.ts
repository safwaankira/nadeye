import { defineConfig } from "vitest/config";

// config.yaml reads contract addresses from ENVIO_* variables; tests use fixed local ones.
export default defineConfig({
  test: {
    env: {
      ENVIO_NADEYE_ADDRESS: process.env.ENVIO_NADEYE_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      ENVIO_PASSKEYS_ADDRESS: process.env.ENVIO_PASSKEYS_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    },
  },
});
