import { getSapBackend, requestFromHeaders, sapError, sapJson } from "@/lib/sap/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const backend = await getSapBackend();
    const workspace = await backend.getWorkspace(requestFromHeaders(request));
    return sapJson(200, {
      ...workspace.session.snapshot(),
      identity: backend.identity,
      authMode: backend.authMode,
      environmentLabel: backend.environmentLabel,
    });
  } catch (error) {
    return sapError(error);
  }
}
