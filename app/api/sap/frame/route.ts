import { getSapBackend, requestFromHeaders, sapError } from "@/lib/sap/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const backend = await getSapBackend();
    const workspace = await backend.getWorkspace(requestFromHeaders(request));
    const image = await workspace.computer.screenshot();
    return new Response(image, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return sapError(error);
  }
}
