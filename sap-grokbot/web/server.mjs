import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { loadTarget, startComputer } from "../worker/computer.mjs";
import { createSession, DemoError } from "../worker/session.mjs";
import { loadModels } from "../worker/models.mjs";

const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/demo.css", ["demo.css", "text/css; charset=utf-8"]],
  ["/demo.js", ["demo.js", "text/javascript; charset=utf-8"]],
]);

const LOCAL_ACTOR_PATTERN = /^[A-Za-z0-9_@.+|=-]{1,200}$/;

export function resolveAuthMode(value = "entra") {
  const mode = String(value || "entra").trim().toLowerCase();
  if (mode !== "entra" && mode !== "none") {
    throw new Error("SAP_AUTH_MODE must be 'entra' or 'none'");
  }
  return mode;
}

function isLoopbackOrigin(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]" || url.hostname === "::1") &&
      url.origin === value;
  } catch {
    return false;
  }
}

function loadSapUsers(env) {
  return new Map(Object.entries(JSON.parse(env.SAP_USER_MAP || "{}")));
}

function requireSapUserMap(sapUsers, actor) {
  if (!sapUsers.size || [...sapUsers.values()].some((user) => typeof user !== "string" || !user.trim())) {
    throw new Error("SAP target requires a SAP_USER_MAP from identity to SAP user");
  }
  if (!sapUsers.has(actor) || typeof sapUsers.get(actor) !== "string" || !sapUsers.get(actor).trim()) {
    throw new Error(`SAP_USER_MAP must include the local test identity '${actor}'`);
  }
}

async function readCommand(request) {
  if (request.headers["content-type"] !== "application/json") {
    throw new DemoError(415, "JSON erwartet.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 4096) {
      request.resume();
      throw new DemoError(413, "Anfrage zu groß.");
    }
    chunks.push(chunk);
  }
  try {
    const command = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (command && typeof command.action === "string") return command;
  } catch {
    // Invalid JSON and invalid command shapes both return HTTP 400.
  }
  throw new DemoError(400, "Ungültiger Auftrag.");
}

function createAppHandler(getWorkspace, origin) {
  const host = new URL(origin).host;
  return async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; object-src 'none'");

    function send(status, type, body) {
      response.writeHead(status, { "Content-Type": type });
      response.end(body);
    }

    function json(status, data) {
      send(status, "application/json; charset=utf-8", JSON.stringify(data));
    }

    try {
      if (request.headers.host !== host) throw new DemoError(403, "Ungültiger Host.");
      const path = request.url.split("?")[0];
      if (request.method === "POST" && path === "/api/action") {
        if (request.headers.origin !== origin) throw new DemoError(403, "Ungültige Herkunft.");
        const { session } = await getWorkspace(request);
        return json(200, await session.dispatch(await readCommand(request)));
      }
      if (request.method === "GET") {
        if (path === "/api/state") return json(200, (await getWorkspace(request)).session.snapshot());
        if (path === "/api/frame") return send(200, "image/jpeg", await (await getWorkspace(request)).computer.screenshot());
        const asset = assets.get(path);
        if (asset) return send(200, asset[1], await readFile(new URL(asset[0], import.meta.url)));
      }
      throw new DemoError(404, "Seite nicht gefunden.");
    } catch (error) {
      if (error instanceof DemoError) return json(error.status, { error: error.message });
      console.error("SAP workspace request failed", error?.name);
      return json(500, { error: "Der Bot-Browser antwortet gerade nicht." });
    }
  };
}

export function createDemoHandler(computer, origin, options) {
  const session = createSession(computer, options);
  return createAppHandler(() => ({ computer, session }), origin);
}

export function createCloudWorkspaces({ openComputer, models, auditFile, orderLabel, proxySecret, allowedGroup, fixedActor, max = 10 }) {
  const secret = proxySecret == null ? undefined : Buffer.from(proxySecret);
  const active = new Map();
  const idleMs = 30 * 60 * 1000;
  const sweeper = setInterval(() => {
    for (const [actor, entry] of active) {
      if (entry.seen > Date.now() - idleMs) continue;
      active.delete(actor);
      void entry.workspace.then(({ computer }) => computer.close()).catch(() => {});
    }
  }, 60000);
  sweeper.unref();
  return {
    async get(request) {
      let actor;
      if (fixedActor) {
        actor = fixedActor;
      } else {
        const forwarded = Buffer.from(String(request.headers["x-grokbot-proxy-secret"] || ""));
        actor = request.headers["x-auth-request-user"];
        if (!secret || forwarded.length !== secret.length || !timingSafeEqual(forwarded, secret) ||
            typeof actor !== "string" || !LOCAL_ACTOR_PATTERN.test(actor)) {
          throw new DemoError(401, "Anmeldung erforderlich.");
        }
        const groups = String(request.headers["x-auth-request-groups"] || "").split(",").map((group) => group.trim());
        if (!groups.includes(allowedGroup)) throw new DemoError(403, "Kein Zugriff für diese Entra-Gruppe.");
      }
      let entry = active.get(actor);
      if (!entry) {
        if (active.size >= max) throw new DemoError(503, "Alle Bot-Browser sind derzeit belegt.");
        const workspace = Promise.resolve().then(() => openComputer(actor)).then((computer) => ({
          computer,
          session: createSession(computer, {
            models,
            orderLabel,
            writeAudit: (event) => appendFileSync(auditFile, JSON.stringify({ actor, ...event }) + "\n", { mode: 0o600, flush: true }),
          }),
        }));
        entry = { workspace, seen: Date.now() };
        active.set(actor, entry);
        void workspace.catch(() => active.delete(actor));
      }
      entry.seen = Date.now();
      return entry.workspace;
    },
    async close() {
      clearInterval(sweeper);
      await Promise.allSettled([...active.values()].map(({ workspace }) => workspace.then(({ computer }) => computer.close())));
      active.clear();
    },
  };
}

function createLocalNoAuthWorkspaces({ openComputer, models, auditFile, orderLabel, actor }) {
  return createCloudWorkspaces({
    openComputer,
    models,
    auditFile,
    orderLabel,
    fixedActor: actor,
  });
}

export async function startDemo({ port = 3211, env = process.env, warn = console.warn } = {}) {
  const models = loadModels(env);
  const authMode = resolveAuthMode(env.SAP_AUTH_MODE);
  const publicOrigin = env.SAP_APP_ORIGIN;
  const target = loadTarget(env.SAP_BROWSER_TARGET);
  const sapUsers = loadSapUsers(env);
  const localActor = env.SAP_LOCAL_ACTOR || "local-test";

  if (authMode === "none") {
    if (!LOCAL_ACTOR_PATTERN.test(localActor)) {
      throw new Error("SAP_LOCAL_ACTOR must be a short local test identity");
    }
    if (!env.SAP_AUDIT_FILE) {
      throw new Error("SAP_AUTH_MODE=none requires SAP_AUDIT_FILE");
    }
    if (publicOrigin && !isLoopbackOrigin(publicOrigin)) {
      throw new Error("SAP_AUTH_MODE=none only allows a loopback SAP_APP_ORIGIN");
    }
    if (target) requireSapUserMap(sapUsers, localActor);
    warn("WARNING: SAP_AUTH_MODE=none disables Entra/OAuth2-Proxy. Loopback-only local testing with fixed identity '" +
      localActor + "'. Do not expose this mode on a network.");
  } else {
    if (publicOrigin && (new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith("https://") ||
        !env.SAP_AUDIT_FILE || !/^[a-f0-9]{64}$/.test(env.SAP_PROXY_SECRET || "") ||
        !/^[a-f0-9-]{36}$/i.test(env.SAP_ENTRA_GROUP || ""))) {
      throw new Error("Cloud mode requires SAP_APP_ORIGIN, SAP_AUDIT_FILE, SAP_ENTRA_GROUP and a 32-byte hex SAP_PROXY_SECRET");
    }
    if (target && !publicOrigin) {
      throw new Error("SAP target requires authenticated cloud mode (set SAP_AUTH_MODE=none for local no-Entra testing)");
    }
    if (target && (!sapUsers.size || [...sapUsers.values()].some((user) => typeof user !== "string" || !user.trim()))) {
      throw new Error("SAP target requires a SAP_USER_MAP from Entra subject to SAP user");
    }
  }

  const workspaces = authMode === "none"
    ? createLocalNoAuthWorkspaces({
      models,
      auditFile: env.SAP_AUDIT_FILE,
      actor: localActor,
      openComputer(actor) {
        const sapUser = sapUsers.get(actor);
        if (target && !sapUser) throw new DemoError(403, "Für diese Anmeldung fehlt die SAP-Benutzerzuordnung.");
        return startComputer(target, sapUser);
      },
      orderLabel: target?.label,
    })
    : publicOrigin
      ? createCloudWorkspaces({
        models, auditFile: env.SAP_AUDIT_FILE, proxySecret: env.SAP_PROXY_SECRET, allowedGroup: env.SAP_ENTRA_GROUP,
        openComputer(actor) {
          const sapUser = sapUsers.get(actor);
          if (target && !sapUser) throw new DemoError(403, "Für diese Anmeldung fehlt die SAP-Benutzerzuordnung.");
          return startComputer(target, sapUser);
        },
        orderLabel: target?.label,
      })
      : undefined;
  const computer = workspaces ? undefined : await startComputer();
  const closeComputers = () => workspaces ? workspaces.close() : computer.close();
  let handle;
  const server = createServer((request, response) => handle(request, response));
  let origin;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      // Always bind to loopback. Entra cloud mode sits behind Caddy on the same host;
      // SAP_AUTH_MODE=none is intentionally single-machine only.
      server.listen(port, "127.0.0.1", resolve);
    });
    origin = publicOrigin || `http://127.0.0.1:${server.address().port}`;
    handle = workspaces ? createAppHandler(workspaces.get, origin) : createDemoHandler(computer, origin, { models });
  } catch (error) {
    await closeComputers();
    throw error;
  }
  return {
    origin,
    authMode,
    async close() {
      await Promise.all([closeComputers(), new Promise((resolve) => server.close(resolve))]);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.SAP_DEMO_PORT || 3211);
  const demo = await startDemo({ port });
  console.log(`SAP GrokBot Demo: ${demo.origin}`);
  process.once("SIGINT", () => void demo.close());
  process.once("SIGTERM", () => void demo.close());
}
