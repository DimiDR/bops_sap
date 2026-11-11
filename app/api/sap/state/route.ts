import { getSapBackend, requestFromHeaders, sapError, sapJson } from "@/lib/sap/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const backend = await getSapBackend();
    const headers = requestFromHeaders(request);
    const workspace = await backend.getWorkspace(headers);
    return sapJson(200, {
      ...workspace.session.snapshot(),
      identity: backend.resolveIdentity(headers),
      authMode: backend.authMode,
      authSource: backend.authSource,
      authSourceLabel: backend.authSourceLabel,
      environmentLabel: backend.environmentLabel,
    });
  } catch (error) {
    return sapError(error);
  }
}
