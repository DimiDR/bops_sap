import { assertSapOrigin, getSapBackend, requestFromHeaders, sapError, sapJson } from "@/lib/sap/runtime";
import { DemoError } from "../../../../sap-grokbot/worker/session.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSapOrigin(request);
    if (request.headers.get("content-type") !== "application/json") {
      throw new DemoError(415, "JSON erwartet.");
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body.action !== "string") throw new DemoError(400, "Ungültiger Auftrag.");
    const backend = await getSapBackend();
    const workspace = await backend.getWorkspace(requestFromHeaders(request));
    const result = await workspace.session.dispatch(body);
    return sapJson(200, {
      ...result,
      identity: backend.identity,
      authMode: backend.authMode,
      environmentLabel: backend.environmentLabel,
    });
  } catch (error) {
    return sapError(error);
  }
}
