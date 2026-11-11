export type SapAuditEvent = {
  id: string;
  event: string;
  at: string;
};

export type SapPending = {
  id: string;
  previous: string;
  proposed: string;
};

export type SapState = {
  mode: "bot" | "human";
  pending: SapPending | null;
  audit: SapAuditEvent[];
  modelIds: string[];
  orderLabel: string;
  writable: boolean;
  liveSap: boolean;
  message?: string;
  identity: string | null;
  authMode: "entra" | "none";
  /** "entra" only when SAP_APP_ORIGIN cloud mode uses proxy identity headers. */
  authSource: "local" | "entra";
  authSourceLabel: string;
  environmentLabel: string;
};

export type SapChatItem =
  | { kind: "message"; id: string; role: "user" | "bot" | "error"; text: string }
  | { kind: "approval"; id: string; pending: SapPending; resolved?: "approved" | "rejected" | "stale" | "unconfirmed" | "invalidated" };
