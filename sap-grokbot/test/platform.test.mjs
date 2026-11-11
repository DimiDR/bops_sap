import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { test } from "node:test";
import { createConnectorHandler, loadConnector, selectRule } from "../connector/server.mjs";
import { createCloudWorkspaces, resolveAuthMode, startDemo } from "../web/server.mjs";
import { loadModels } from "../worker/models.mjs";
import { createSession } from "../worker/session.mjs";

test("Model profiles keep keys on the server and can only propose a change", async () => {
  const models = loadModels({
    SAP_MODEL_PROFILES: JSON.stringify([
      { id: "first", url: "https://example.test/v1/chat/completions", model: "one", keyEnv: "FIRST_KEY" },
      { id: "second", url: "http://127.0.0.1:9000/v1/chat/completions", model: "two" },
    ]),
    FIRST_KEY: "test-key",
  }, async (url, options) => {
    assert.equal(url.host, "example.test");
    assert.equal(options.headers.Authorization, "Bearer test-key");
    assert.equal(options.redirect, "error");
    assert.equal(JSON.parse(options.body).model, "one");
    return Response.json({ choices: [{ message: { tool_calls: [
      { function: { name: "propose_note", arguments: '{"text":"Neuer Wert"}' } },
    ] } }] });
  });
  let note = "Alt";
  const session = createSession({ readNote: async () => note, writeNote: async (value) => { note = value; } }, { models });
  assert.deepEqual(session.snapshot().modelIds, ["first", "second"]);
  const state = await session.dispatch({ action: "message", text: "Bitte setze die Notiz auf Neuer Wert", model: "first" });
  assert.equal(note, "Alt");
  await assert.rejects(session.dispatch({ action: "approve", id: "fake" }), { status: 409 });
  await session.dispatch({ action: "approve", id: state.pending.id });
  assert.equal(note, "Neuer Wert");
  await assert.rejects(session.dispatch({ action: "message", text: "Schreibe etwas", model: "first" }), { status: 400 });
  await assert.rejects(session.dispatch({ action: "message", text: "Schreibe etwas", model: "missing" }), { status: 400 });
});

test("Connector checks paths, methods, override headers and redirect origins", async () => {
  const config = loadConnector({
    SAP_CONNECTOR_UPSTREAM: "https://sap.internal",
    SAP_CONNECTOR_PUBLIC_ORIGIN: "https://sap.tail.test",
    SAP_CONNECTOR_LOGIN_ORIGINS: "https://login.microsoftonline.com",
    SAP_CONNECTOR_RULES: '[{"id":"app","path":"/sap/app/","prefix":true,"methods":["GET"]}]',
  });
  for (const path of ["/sap/application", "/sap/app/../admin", "/sap/app/%2e%2e/admin",
    "/sap/app//test", "/sap/app/xyz;special=one", "/sap/app/$batch", "https://sap.internal/sap/app/file"]) {
    assert.equal(selectRule(path, "GET", config.rules), undefined, path);
  }
  let forwarded = 0;
  let redirect;
  const handler = createConnectorHandler(config, (upstream, options, callback) => {
    assert.equal(upstream.origin, "https://sap.internal");
    assert.equal(options.headers.host, "sap.internal");
    assert.equal(options.headers["x-forwarded-host"], "sap.tail.test");
    assert.equal(options.headers["x-http-method-override"], undefined);
    assert.equal(options.headers.cookie, "sap-session=test");
    forwarded++;
    const socket = new PassThrough();
    socket.on("finish", () => {
      const reply = Readable.from(["response"]);
      reply.headers = redirect ? { location: redirect } : {};
      reply.statusCode = redirect ? 302 : 200;
      callback(reply);
    });
    return socket;
  }, () => {});

  async function get(path, method = "GET") {
    const request = Object.assign(Readable.from([]), {
      url: path, method, headers: {
        host: "sap.tail.test", "x-http-method-override": "DELETE", "x-forwarded-host": "spoofed", cookie: "sap-session=test",
      },
    });
    const response = new Writable({ write(_chunk, _encoding, next) { next(); } });
    response.writeHead = (status, headers) => { response.status = status; response.headers = headers; return response; };
    await handler(request, response);
    await finished(response);
    return response;
  }
  assert.equal((await get("/sap/app/index")).status, 200);
  assert.equal((await get("/sap/app/index", "POST")).status, 403);
  assert.equal(forwarded, 1);
  redirect = "https://sap.internal/sap/app/next";
  assert.equal((await get("/sap/app/index")).headers.location, "https://sap.tail.test/sap/app/next");
  redirect = "https://example.test/leak";
  assert.equal((await get("/sap/app/index")).status, 502);
});

test("Cloud workspaces isolate browser state and persist approved audit events", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sap-test-"));
  const auditFile = join(directory, "audit.jsonl");
  const registry = createCloudWorkspaces({
    proxySecret: "test-secret",
    allowedGroup: "pilot",
    auditFile,
    async openComputer(actor) {
      let note = actor;
      return { readNote: async () => note, writeNote: async (value) => { note = value; }, close: async () => {} };
    },
  });
  t.after(async () => { await registry.close(); await rm(directory, { recursive: true, force: true }); });
  const request = (actor, group = "pilot") => ({ headers: {
    "x-auth-request-user": actor, "x-grokbot-proxy-secret": "test-secret", "x-auth-request-groups": group,
  } });
  await assert.rejects(registry.get({ headers: { "x-auth-request-user": "alice" } }), { status: 401 });
  await assert.rejects(registry.get(request("alice", "other")), { status: 403 });
  const [alice, bob] = await Promise.all([registry.get(request("alice")), registry.get(request("bob"))]);
  assert.equal(await registry.get(request("alice")), alice);
  const proposal = await alice.session.dispatch({ action: "message", text: "Notiz ändern: Vertraulich" });
  await assert.rejects(bob.session.dispatch({ action: "approve", id: proposal.pending.id }), { status: 409 });
  await alice.session.dispatch({ action: "approve", id: proposal.pending.id });
  assert.equal(await bob.computer.readNote(), "bob");
  const entries = (await readFile(auditFile, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(entries.map((entry) => entry.event), ["proposed", "approved", "saved"]);
  assert.ok(entries.every((entry) => entry.actor === "alice" && entry.id === proposal.pending.id && !JSON.stringify(entry).includes("Vertraulich")));
});

test("Cloud audit failure prevents the write and consumes the approval", async () => {
  let writes = 0;
  const session = createSession({
    readNote: async () => "Alt",
    writeNote: async () => { writes++; },
  }, {
    writeAudit(event) {
      if (event.event === "approved") throw new Error("Storage unavailable");
    },
  });
  const proposal = await session.dispatch({ action: "message", text: "Notiz ändern: Neu" });
  await assert.rejects(session.dispatch({ action: "approve", id: proposal.pending.id }), /Storage unavailable/);
  assert.equal(writes, 0);
  await assert.rejects(session.dispatch({ action: "approve", id: proposal.pending.id }), { status: 409 });
});

test("Auth mode defaults to Entra and rejects misconfigured no-auth or SAP targets", async () => {
  assert.equal(resolveAuthMode(), "entra");
  assert.equal(resolveAuthMode("ENTRA"), "entra");
  assert.equal(resolveAuthMode("none"), "none");
  assert.throws(() => resolveAuthMode("off"), /SAP_AUTH_MODE/);

  const target = JSON.stringify({
    url: "https://sap.example/sap/bc/ui2/flp",
    label: "Testauftrag",
    loginOrigins: ["https://login.microsoftonline.com"],
    identitySelector: "[data-sap-user]",
    recordSelector: "[data-order-id]",
    recordValue: "4500000173",
    noteSelector: "[data-saved-note]",
    writes: false,
  });
  const warnings = [];
  await assert.rejects(startDemo({
    port: 0,
    warn: (message) => warnings.push(message),
    env: { SAP_BROWSER_TARGET: target, SAP_USER_MAP: JSON.stringify({ "local-test": "SAP_USER" }) },
  }), /authenticated cloud mode|SAP_AUTH_MODE=none/);
  await assert.rejects(startDemo({
    port: 0,
    warn: (message) => warnings.push(message),
    env: {
      SAP_AUTH_MODE: "none",
      SAP_BROWSER_TARGET: target,
      SAP_USER_MAP: JSON.stringify({ "local-test": "SAP_USER" }),
    },
  }), /SAP_AUDIT_FILE/);
  await assert.rejects(startDemo({
    port: 0,
    warn: (message) => warnings.push(message),
    env: {
      SAP_AUTH_MODE: "none",
      SAP_AUDIT_FILE: "/tmp/unused-audit.jsonl",
      SAP_APP_ORIGIN: "https://grokbot.example.com",
      SAP_BROWSER_TARGET: target,
      SAP_USER_MAP: JSON.stringify({ "local-test": "SAP_USER" }),
    },
  }), /loopback SAP_APP_ORIGIN/);
  await assert.rejects(startDemo({
    port: 0,
    warn: (message) => warnings.push(message),
    env: {
      SAP_AUTH_MODE: "none",
      SAP_AUDIT_FILE: "/tmp/unused-audit.jsonl",
      SAP_BROWSER_TARGET: target,
      SAP_USER_MAP: JSON.stringify({ other: "SAP_USER" }),
    },
  }), /local test identity/);
  await assert.rejects(startDemo({
    port: 0,
    warn: (message) => warnings.push(message),
    env: {
      SAP_APP_ORIGIN: "https://grokbot.example.com",
      SAP_AUDIT_FILE: "/tmp/unused-audit.jsonl",
      SAP_BROWSER_TARGET: target,
      SAP_USER_MAP: JSON.stringify({ alice: "SAP_USER" }),
    },
  }), /SAP_ENTRA_GROUP|SAP_PROXY_SECRET/);
  assert.equal(warnings.length, 0);
});

test("Auth none mode uses a fixed local identity without Entra headers", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "sap-auth-"));
  const auditFile = join(directory, "audit.jsonl");
  const warnings = [];
  const registry = createCloudWorkspaces({
    fixedActor: "local-test",
    auditFile,
    async openComputer(actor) {
      assert.equal(actor, "local-test");
      let note = "Alt";
      return { readNote: async () => note, writeNote: async (value) => { note = value; }, close: async () => {} };
    },
  });
  t.after(async () => { await registry.close(); await rm(directory, { recursive: true, force: true }); });
  const workspace = await registry.get({ headers: {} });
  const proposal = await workspace.session.dispatch({ action: "message", text: "Notiz ändern: Lokal" });
  await workspace.session.dispatch({ action: "approve", id: proposal.pending.id });
  const entries = (await readFile(auditFile, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(entries.every((entry) => entry.actor === "local-test"));
  assert.deepEqual(entries.map((entry) => entry.event), ["proposed", "approved", "saved"]);

  const demo = await startDemo({
    port: 0,
    warn: (message) => warnings.push(String(message)),
    env: {
      SAP_AUTH_MODE: "NONE",
      SAP_AUDIT_FILE: join(directory, "boot-check.jsonl"),
      SAP_LOCAL_ACTOR: "desk-user",
      SAP_BROWSER_TARGET: JSON.stringify({
        url: "https://sap.example/sap/bc/ui2/flp",
        label: "Testauftrag",
        loginOrigins: ["https://login.microsoftonline.com"],
        identitySelector: "[data-sap-user]",
        recordSelector: "[data-order-id]",
        recordValue: "4500000173",
        noteSelector: "[data-saved-note]",
        writes: false,
      }),
      SAP_USER_MAP: JSON.stringify({ "desk-user": "SAP_DESK" }),
    },
  });
  t.after(demo.close);
  assert.equal(demo.authMode, "none");
  assert.match(demo.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(warnings.join("\n"), /SAP_AUTH_MODE=none/);
  assert.match(warnings.join("\n"), /desk-user/);
});
