import type { SapState } from "./types";

export async function fetchSapState(): Promise<SapState> {
  const response = await fetch("/api/sap/state", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Die Demo-Sitzung ist nicht erreichbar.");
  return data as SapState;
}

export async function postSapAction(command: Record<string, unknown>): Promise<SapState> {
  const response = await fetch("/api/sap/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Auftrag fehlgeschlagen.") as Error & { status?: number; state?: SapState };
    error.status = response.status;
    if (response.status === 409) {
      try {
        error.state = await fetchSapState();
      } catch {
        /* keep original */
      }
    }
    throw error;
  }
  return data as SapState;
}

export function frameUrl() {
  return `/api/sap/frame?t=${Date.now()}`;
}
