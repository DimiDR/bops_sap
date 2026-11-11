#!/usr/bin/env node
/**
 * Starts the Bops Next.js app with the SAP GrokBot UI at /sap.
 * Backend: app/api/sap/* → sap-grokbot worker/session (same security model as server.mjs).
 */
import { spawn } from "node:child_process";

const port = process.env.SAP_DEMO_PORT || "3211";
const host = "127.0.0.1";
const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "dev", "--hostname", host, "--port", port],
  { stdio: "inherit", env: process.env },
);

console.log(`SAP GrokBot UI: http://${host}:${port}/sap`);
console.log("(Bops chat/sidebar/computer shell → /api/sap → sap-grokbot workers)");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
