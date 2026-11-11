declare module "../../sap-grokbot/web/server.mjs" {
  export function resolveAuthMode(value?: string): "entra" | "none";
  export function createSapBackend(options?: {
    env?: NodeJS.ProcessEnv;
    warn?: (...args: unknown[]) => void;
    publicOrigin?: string;
  }): Promise<{
    authMode: "entra" | "none";
    identity: string | null;
    environmentLabel: string;
    preferredOrigin: string | null;
    getWorkspace: (request: { headers: Record<string, string> }) => Promise<{
      computer: { screenshot: () => Promise<Buffer>; close: () => Promise<void> };
      session: { snapshot: (message?: string) => unknown; dispatch: (command: unknown) => Promise<Record<string, unknown>> };
    }>;
    close: () => Promise<void>;
  }>;
  export function createDemoHandler(...args: unknown[]): unknown;
  export function createCloudWorkspaces(...args: unknown[]): unknown;
  export function startDemo(...args: unknown[]): Promise<{ origin: string; authMode: string; close: () => Promise<void> }>;
}

declare module "../../sap-grokbot/worker/session.mjs" {
  export class DemoError extends Error {
    status: number;
    constructor(status: number, message: string);
  }
  export function createSession(...args: unknown[]): unknown;
}

declare module "../../../../sap-grokbot/worker/session.mjs" {
  export class DemoError extends Error {
    status: number;
    constructor(status: number, message: string);
  }
}
