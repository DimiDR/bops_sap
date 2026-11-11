import { randomUUID } from "node:crypto";

export class DemoError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createSession(computer, { models, writeAudit, orderLabel = "Auftrag 4500000173" } = {}) {
  let mode = "bot";
  let pending = null;
  let queue = Promise.resolve();
  const audit = [];

  function record(id, event) {
    const entry = { id, event, at: new Date().toISOString() };
    writeAudit?.(entry);
    audit.push(entry);
    if (audit.length > 20) audit.shift();
  }

  function snapshot(message) {
    return {
      mode, pending, audit: audit.slice().reverse(), modelIds: models?.ids ?? [],
      orderLabel, writable: computer.writable !== false, liveSap: computer.liveSap === true, message,
    };
  }

  async function run({ action, text, id, mode: requestedMode, input, model }) {
    switch (action) {
      case "mode":
        if (requestedMode !== "bot" && requestedMode !== "human") {
          throw new DemoError(400, "Unbekannter Bedienmodus.");
        }
        if (requestedMode === "human" && pending) {
          record(pending.id, "invalidated");
          pending = null;
        }
        mode = requestedMode;
        return snapshot(mode === "human" ? "Du steuerst den Bot-Browser." : "Der Bot kann wieder Aufgaben annehmen.");
      case "input":
        if (mode !== "human") throw new DemoError(409, "Übernimm zuerst die Steuerung.");
        await computer.input(input);
        return snapshot();
      case "message": {
        if (mode !== "bot") throw new DemoError(409, "Gib zuerst die Steuerung an den Bot zurück.");
        if (typeof text !== "string" || text.length > 200) throw new DemoError(400, "Der Auftrag ist ungültig oder zu lang.");
        const task = text.trim();
        let read = /^(notiz )?lesen[.!]?$/i.test(task);
        let proposed = /^notiz ändern:\s*(.+)$/i.exec(task)?.[1];
        if (model && !read && !proposed) {
          if (!models?.ids.includes(model)) throw new DemoError(400, "Dieses Modell ist nicht konfiguriert.");
          let intent;
          try {
            intent = await models.interpret(model, task);
          } catch {
            throw new DemoError(502, "Der Modellanbieter konnte den Auftrag nicht verarbeiten.");
          }
          read = intent?.action === "read";
          proposed = intent?.action === "propose" ? intent.text : undefined;
        }
        if (read) return snapshot(`${orderLabel} hat die Notiz „${await computer.readNote()}“.`);
        if (!proposed || proposed.length > 120 || /[\u0000-\u001f\u007f]/.test(proposed)) {
          throw new DemoError(400, "Verwende „Notiz lesen“ oder „Notiz ändern: Dein Text“ (bis zu 120 Zeichen).");
        }
        if (computer.writable === false) throw new DemoError(403, "Schreiben ist für diesen SAP-Prozess gesperrt.");
        if (pending) throw new DemoError(409, "Entscheide zuerst über die offene Freigabe.");
        const previous = await computer.readNote();
        if (previous === proposed) return snapshot("Der gewünschte Wert ist bereits gespeichert.");
        const proposal = { id: randomUUID(), previous, proposed };
        record(proposal.id, "proposed");
        pending = proposal;
        return snapshot("Prüfe die Werte und entscheide über die Änderung.");
      }
      case "reject":
      case "approve": {
        if (mode !== "bot" || !pending || pending.id !== id) {
          throw new DemoError(409, "Diese Freigabe ist abgelaufen oder bereits verarbeitet.");
        }
        const change = pending;
        if (action === "reject") {
          pending = null;
          record(id, "rejected");
          return snapshot("Änderung abgelehnt.");
        }
        const actual = await computer.readNote();
        pending = null;
        if (actual !== change.previous) {
          record(id, "stale");
          return snapshot("Die Notiz hat sich geändert. Stelle einen neuen Auftrag.");
        }
        record(id, "approved");
        try {
          await computer.writeNote(change.proposed);
          if (await computer.readNote() !== change.proposed) throw new Error("Readback mismatch");
        } catch {
          record(id, "unconfirmed");
          return snapshot("Das Speichern konnte nicht bestätigt werden. Prüfe den Wert in der Live-Ansicht.");
        }
        record(id, "saved");
        return snapshot(`Notiz gespeichert: „${change.proposed}“.`);
      }
      default:
        throw new DemoError(400, "Unbekannte Aktion.");
    }
  }

  return {
    snapshot,
    dispatch(command) {
      const result = queue.then(() => run(command));
      queue = result.catch(() => {});
      return result;
    },
  };
}
