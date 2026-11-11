import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { DemoError } from "./session.mjs";

export const viewport = { width: 1000, height: 620 };
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const playwrightChromium = chromium.executablePath();
export const browserExecutable = process.env.SAP_DEMO_BROWSER ||
  (existsSync(playwrightChromium) ? playwrightChromium : existsSync(edge) ? edge : undefined);

export function loadTarget(value) {
  if (!value) return undefined;
  const target = JSON.parse(value);
  const url = new URL(target.url);
  if (url.protocol !== "https:" || url.username || url.password ||
      !Array.isArray(target.loginOrigins) || typeof target.noteSelector !== "string" ||
      !target.noteSelector.trim() || typeof target.label !== "string" || !target.label.trim() ||
      typeof target.identitySelector !== "string" || !target.identitySelector.trim() ||
      typeof target.recordSelector !== "string" || !target.recordSelector.trim() ||
      typeof target.recordValue !== "string" || !target.recordValue.trim() ||
      (target.writes === true && (!target.editSelector || !target.saveSelector ||
        typeof target.saveRequestPath !== "string" || !target.saveRequestPath.startsWith("/sap/") ||
        !["POST", "PATCH", "PUT"].includes(target.saveMethod)))) {
    throw new Error("Invalid SAP_BROWSER_TARGET");
  }
  const allowed = new Set([url.origin]);
  for (const value of target.loginOrigins) {
    const origin = new URL(value);
    if (origin.origin !== value || origin.protocol !== "https:") throw new Error("Invalid SAP login origin");
    allowed.add(value);
  }
  return { ...target, url, allowed };
}

export async function startComputer(target, sapUser) {
  const browser = await chromium.launch({
    executablePath: browserExecutable, timeout: 10000, chromiumSandbox: Boolean(target),
  });
  try {
    const page = await browser.newPage({ viewport, serviceWorkers: "block", acceptDownloads: false });
    page.setDefaultTimeout(5000);
    await page.context().route("**/*", (route) =>
      target?.allowed.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    if (target) await page.goto(target.url.href, { waitUntil: "domcontentloaded", timeout: 15000 });
    else await page.setContent(await readFile(new URL("./testmaske.html", import.meta.url), "utf8"));
    const note = target ? page.locator(target.noteSelector) : page.getByTestId("saved-note");
    const edit = target ? page.locator(target.editSelector || ":not(*)") : page.getByLabel("Interne Notiz");
    const save = target ? page.locator(target.saveSelector || ":not(*)") : page.getByRole("button", { name: "Speichern" });
    let screenshot;

    async function ensureSapScreen() {
      if (!target) return;
      if (new URL(page.url()).origin !== target.url.origin) {
        throw new DemoError(409, "Übernimm die Steuerung und melde dich zuerst in SAP an.");
      }
      const identity = page.locator(target.identitySelector);
      if (await identity.count() !== 1 || (await identity.innerText()).trim() !== sapUser) {
        throw new DemoError(403, "Der angemeldete SAP-Benutzer stimmt nicht mit der Zuordnung überein.");
      }
      const record = page.locator(target.recordSelector);
      if (await record.count() !== 1 || (await record.innerText()).trim() !== target.recordValue) {
        throw new DemoError(409, "Öffne zuerst den freigegebenen SAP-Datensatz.");
      }
    }

    return {
      liveSap: Boolean(target),
      writable: !target || target.writes === true,
      close: () => browser.close(),
      screenshot() {
        screenshot ??= page.screenshot({ type: "jpeg", quality: 74, timeout: 5000 })
          .finally(() => { screenshot = undefined; });
        return screenshot;
      },
      async readNote() {
        await ensureSapScreen();
        return target?.noteIsInput ? note.inputValue() : note.innerText();
      },
      async writeNote(value) {
        await ensureSapScreen();
        if (target && target.writes !== true) throw new DemoError(403, "Schreiben ist für diesen SAP-Prozess gesperrt.");
        await edit.fill(value);
        if (!target) return save.click();
        const [response] = await Promise.all([
          page.waitForResponse((reply) => {
            const url = new URL(reply.url());
            return url.origin === target.url.origin && url.pathname === target.saveRequestPath &&
              reply.request().method() === target.saveMethod;
          }, { timeout: 10000 }),
          save.click(),
        ]);
        if (!response.ok()) throw new Error("SAP save request failed");
        await page.goto(target.url.href, { waitUntil: "domcontentloaded", timeout: 15000 });
      },
      async input(event) {
        if (event?.type === "click" && Number.isFinite(event.x) && Number.isFinite(event.y) &&
            event.x >= 0 && event.x < viewport.width && event.y >= 0 && event.y < viewport.height) {
          await page.mouse.click(event.x, event.y);
          return;
        }
        if (event?.type === "text" && typeof event.text === "string" &&
            event.text.length <= 120 && !/[\u0000-\u001f\u007f]/.test(event.text)) {
          await page.keyboard.insertText(event.text);
          return;
        }
        if (event?.type === "key" && ["Backspace", "Enter", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          await page.keyboard.press(event.key);
          return;
        }
        throw new DemoError(400, "Diese Eingabe wird in der Testmaske nicht unterstützt.");
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
