import { createSapBackend } from "../../sap-grokbot/web/server.mjs";
import { DemoError } from "../../sap-grokbot/worker/session.mjs";

type SapBackend = Awaited<ReturnType<typeof createSapBackend>>;

declare global {
  // eslint-disable-next-line no-var
  var __sapGrokBotBackend: Promise<SapBackend> | undefined;
}

/** One Playwright workspace per Next.js process (local demo / no-auth / Entra cloud). */
export function getSapBackend(): Promise<SapBackend> {
  globalThis.__sapGrokBotBackend ??= createSapBackend({ env: process.env });
  return globalThis.__sapGrokBotBackend;
}

export function sapJson(status: number, data: unknown) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function sapError(error: unknown) {
  if (error instanceof DemoError) return sapJson(error.status, { error: error.message });
  console.error("SAP GrokBot request failed", error instanceof Error ? error.name : "unknown");
  return sapJson(500, { error: "Der Bot-Browser antwortet gerade nicht." });
}

/** Same-origin (or configured SAP_APP_ORIGIN) check for mutating SAP API calls. */
export function assertSapOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new DemoError(403, "Ungültige Herkunft.");
  const configured = process.env.SAP_APP_ORIGIN;
  if (configured) {
    if (origin !== configured) throw new DemoError(403, "Ungültige Herkunft.");
    return;
  }
  // Next may rewrite request.url's host; compare Origin to the browser-facing Host header.
  const host = request.headers.get("host");
  let from = "";
  try {
    from = new URL(origin).host;
  } catch {
    throw new DemoError(403, "Ungültige Herkunft.");
  }
  if (!host || from.toLowerCase() !== host.toLowerCase()) {
    throw new DemoError(403, "Ungültige Herkunft.");
  }
}

export function requestFromHeaders(request: Request) {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return { headers };
}
