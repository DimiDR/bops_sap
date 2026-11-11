import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { createDemoHandler } from "../web/server.mjs";
import { browserExecutable, viewport } from "../worker/computer.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on("error", reject);
  });
}

function killPort(port) {
  try {
    const out = execFileSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { encoding: "utf8" });
    for (const pid of out.trim().split(/\s+/).filter(Boolean)) {
      try { process.kill(Number(pid), "SIGKILL"); } catch { /* already gone */ }
    }
  } catch {
    /* nothing listening */
  }
}

async function waitForUrl(url, timeoutMs = 120000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status > 0 && response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function startSapUi(t) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  killPort(port);
  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: root,
      env: { ...process.env, SAP_DEMO_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const stop = () => {
    try { child.stdout?.destroy(); } catch { /* ignore */ }
    try { child.stderr?.destroy(); } catch { /* ignore */ }
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }
    killPort(port);
  };
  t.after(stop);
  try {
    await waitForUrl(`${origin}/sap`);
  } catch (error) {
    stop();
    throw new Error(`Next.js SAP UI failed to start.\n${output}\n${error}`);
  }
  return origin;
}

test("HTTP: approval is bound to the proposal, single-use, and invalidated by takeover", async () => {
  let note = "Liefertermin prüfen";
  let writes = 0;
  let loseResponse = false;
  const origin = "http://127.0.0.1:3211";
  const handle = createDemoHandler({
    readNote: async () => note,
    writeNote: async (value) => {
      writes++;
      note = value;
      if (loseResponse) throw new Error("Connection lost after save");
    },
  }, origin);
  async function send(command, status = 200, requestOrigin = origin) {
    const request = Object.assign(Readable.from([Buffer.from(JSON.stringify(command))]), {
      url: "/api/action",
      method: "POST",
      headers: { host: "127.0.0.1:3211", origin: requestOrigin, "content-type": "application/json" },
    });
    const response = {};
    await handle(request, {
      setHeader() {},
      writeHead(code) { response.status = code; },
      end(data) { response.body = JSON.parse(data); },
    });
    if (status === null) return response;
    assert.equal(response.status, status, JSON.stringify(response.body));
    return response.body;
  }
  const initial = await send({ action: "message", text: "Notiz lesen" });
  assert.match(initial.message, /Liefertermin prüfen/);
  const proposed = await send({ action: "message", text: "Notiz ändern: Lieferung bestätigt" });
  const id = proposed.pending.id;
  await send({ action: "approve", id }, 403, "https://other.example");
  await send({ action: "approve", id: "different" }, 409);
  await send({ action: "input", input: { type: "text", text: "unerlaubt" } }, 409);
  assert.match((await send({ action: "message", text: "Notiz lesen" })).message, /Liefertermin prüfen/);
  const concurrent = await Promise.allSettled([
    send({ action: "approve", id, text: "Nicht freigegeben" }, null),
    send({ action: "approve", id, text: "Nicht freigegeben" }, null),
  ]);
  for (const result of concurrent) {
    if (result.status === "rejected") throw result.reason;
  }
  const responses = concurrent.map((result) => result.value);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const saved = responses.find((response) => response.status === 200).body;
  assert.equal(writes, 1);
  assert.deepEqual(saved.audit.map((entry) => entry.event), ["saved", "approved", "proposed"]);
  assert.ok(saved.audit.every((entry) => entry.id === id));
  assert.match((await send({ action: "message", text: "Notiz lesen" })).message, /Lieferung bestätigt/);

  const next = await send({ action: "message", text: "Notiz ändern: später" });
  const taken = await send({ action: "mode", mode: "human" });
  assert.equal(taken.pending, null);
  assert.equal(taken.audit[0].event, "invalidated");
  await send({ action: "message", text: "Notiz lesen" }, 409);
  await send({ action: "mode", mode: "bot" });
  await send({ action: "approve", id: next.pending.id }, 409);

  const last = await send({ action: "message", text: "Notiz ändern: abgelehnt" });
  await send({ action: "reject", id: last.pending.id });
  await send({ action: "approve", id: last.pending.id }, 409);
  assert.match((await send({ action: "message", text: "Notiz lesen" })).message, /Lieferung bestätigt/);

  assert.equal(writes, 1);

  const stale = await send({ action: "message", text: "Notiz ändern: neuer Vorschlag" });
  note = "Zwischenzeitlich geändert";
  const skipped = await send({ action: "approve", id: stale.pending.id });
  assert.equal(skipped.audit[0].event, "stale");
  assert.equal(writes, 1);

  const lastChange = await send({ action: "message", text: "Notiz ändern: gespeichert ohne Antwort" });
  loseResponse = true;
  const unknown = await send({ action: "approve", id: lastChange.pending.id });
  assert.equal(unknown.audit[0].event, "unconfirmed");
  await send({ action: "approve", id: lastChange.pending.id }, 409);
  assert.equal(writes, 2);
});

test("Browser UI: live image, approval and manual input work through the page", async (t) => {
  const origin = await startSapUi(t);
  const browser = await chromium.launch({ executablePath: browserExecutable, timeout: 10000 });
  t.after(() => browser.close());
  const fixture = await browser.newPage({ viewport });
  await fixture.setContent(await readFile(new URL("../worker/testmaske.html", import.meta.url), "utf8"));
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.setDefaultTimeout(20000);
  await page.goto(`${origin}/sap`);
  await page.getByText("Live · Bot-Modus", { exact: true }).waitFor();
  const screenshot = await page.request.get(new URL("/api/sap/frame?t=1", origin).href);
  assert.match(screenshot.headers()["content-type"], /^image\/jpeg$/);
  assert.deepEqual([...(await screenshot.body()).slice(0, 2)], [255, 216]);
  await page.getByRole("button", { name: "Notiz lesen" }).click();
  await page.getByText(/hat die Notiz „Liefertermin prüfen“/).waitFor();
  await page.getByLabel("Nachricht").fill("Notiz ändern: Test erfolgreich");
  await page.getByRole("button", { name: "Senden" }).click();
  await page.getByRole("button", { name: "Freigeben und speichern" }).click();
  await page.getByText("Notiz gespeichert: „Test erfolgreich“.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.getByText("Live · Du steuerst", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Notiz lesen" }).isDisabled(), true);
  const image = page.getByRole("img", { name: "Live-Ansicht der Testmaske" });
  async function clickOnImage(control) {
    const target = await control.boundingBox();
    const screen = await image.boundingBox();
    await image.click({
      position: {
        x: (target.x + target.width / 2) * screen.width / viewport.width,
        y: (target.y + target.height / 2) * screen.height / viewport.height,
      },
    });
  }
  await clickOnImage(fixture.getByLabel("Interne Notiz"));
  await page.getByLabel("Text an ausgewähltes Feld senden").fill("!");
  await page.getByRole("button", { name: "Text eingeben" }).click();
  await clickOnImage(fixture.getByRole("button", { name: "Speichern" }));
  await page.getByRole("button", { name: "An Bot zurückgeben" }).click();
  await page.getByRole("button", { name: "Notiz lesen" }).click();
  await page.getByText(/hat die Notiz „[^“]*![^“]*“/).waitFor();
});
