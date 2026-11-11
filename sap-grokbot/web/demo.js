const byId = (id) => document.getElementById(id);
const messages = byId("messages");
const composer = byId("composer");
const approval = byId("approval");
const takeover = byId("takeover");
const frame = byId("frame");
const remoteText = byId("remote-text");
const auditEvents = byId("audit-events");
const modelSelect = byId("model");
const eventLabels = {
  proposed: "Vorgeschlagen",
  rejected: "Abgelehnt",
  invalidated: "Durch Übernahme ungültig",
  stale: "Ausgangswert geändert",
  approved: "Freigegeben",
  unconfirmed: "Ergebnis ungeklärt",
  saved: "Gespeichert",
};
let state;
let busy = false;
let connected = false;

function addMessage(text, kind = "bot") {
  const message = document.createElement("p");
  message.className = kind;
  message.textContent = text;
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
}

function render() {
  const human = state?.mode === "human";
  takeover.textContent = human ? "An Bot zurückgeben" : "Übernehmen";
  takeover.disabled = !state || busy;
  frame.classList.toggle("controllable", human && connected);
  remoteText.hidden = !human;
  approval.hidden = !state?.pending;
  const status = byId("screen-status");
  const label = connected ? (human ? "Live · Du steuerst" : "Live · Bot-Modus") : "Live-Bild nicht verfügbar";
  if (status.textContent !== label) status.textContent = label;
  if (state) {
    byId("environment-label").textContent = state.liveSap ? "SAP-Testsystem" : "Testmaske · Synthetische Daten";
    byId("introduction").textContent = state.writable
      ? `${state.orderLabel}: Ich kann die Notiz lesen und nach deiner Freigabe ändern.`
      : `${state.orderLabel}: Ich kann die Notiz lesen.`;
    byId("task").placeholder = state.writable ? "Notiz ändern: Lieferung bestätigt" : "Notiz lesen";
  }

  const ids = state?.modelIds ?? [];
  if (ids.join() !== [...modelSelect.options].slice(1).map((option) => option.value).join()) {
    const previous = modelSelect.value;
    modelSelect.replaceChildren(new Option("Lokale Befehle", ""), ...ids.map((id) => new Option(id, id)));
    if (ids.includes(previous)) modelSelect.value = previous;
  }
  for (const control of composer.querySelectorAll("button, input, select")) control.disabled = !state || busy || human;
  for (const control of remoteText.querySelectorAll("button, input")) control.disabled = busy || !connected;
  byId("approve").disabled = busy;
  byId("reject").disabled = busy;
  byId("previous").textContent = state?.pending?.previous ?? "";
  byId("proposed").textContent = state?.pending?.proposed ?? "";
  auditEvents.replaceChildren(...(state?.audit ?? []).map(({ id, event, at }) => {
    const item = document.createElement("li");
    item.textContent = `${new Date(at).toLocaleTimeString("de-DE")} · ${eventLabels[event]} · ${id}`;
    return item;
  }));
}

async function readState() {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("Die Demo-Sitzung ist nicht erreichbar.");
  state = await response.json();
}

async function send(command) {
  if (busy || !state) return false;
  busy = true;
  if (command.action === "message") addMessage(command.text, "user");
  render();
  try {
    const response = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) await readState();
      throw new Error(result.error);
    }
    state = result;
    if (result.message) addMessage(result.message);
    return true;
  } catch (error) {
    addMessage(error.message, "error");
    return false;
  } finally {
    busy = false;
    render();
  }
}

function updateFrame(ok) {
  if (connected !== ok) {
    connected = ok;
    render();
  }
  setTimeout(() => { frame.src = `/api/frame?t=${Date.now()}`; }, ok ? 400 : 1500);
}

frame.addEventListener("load", () => updateFrame(true));
frame.addEventListener("error", () => updateFrame(false));
frame.src = "/api/frame";
readState().catch((error) => addMessage(error.message, "error")).finally(render);

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const task = byId("task");
  if (await send({ action: "message", text: task.value, model: modelSelect.value })) task.value = "";
  task.focus();
});

byId("read").addEventListener("click", () => send({ action: "message", text: "Notiz lesen" }));
for (const action of ["approve", "reject"]) {
  byId(action).addEventListener("click", () => send({ action, id: state?.pending?.id }));
}
takeover.addEventListener("click", () => send({
  action: "mode",
  mode: state.mode === "human" ? "bot" : "human",
}));

frame.addEventListener("click", (event) => {
  if (state?.mode !== "human" || !connected) return;
  const rect = frame.getBoundingClientRect();
  void send({
    action: "input",
    input: {
      type: "click",
      x: ((event.clientX - rect.left) / rect.width) * frame.naturalWidth,
      y: ((event.clientY - rect.top) / rect.height) * frame.naturalHeight,
    },
  });
});

remoteText.addEventListener("submit", async (event) => {
  event.preventDefault();
  const typing = byId("typing");
  if (await send({ action: "input", input: { type: "text", text: typing.value } })) typing.value = "";
  typing.focus();
});
byId("backspace").addEventListener("click", () => send({
  action: "input", input: { type: "key", key: "Backspace" },
}));
byId("enter-key").addEventListener("click", () => send({
  action: "input", input: { type: "key", key: "Enter" },
}));
byId("masked-input").addEventListener("change", (event) => {
  byId("typing").type = event.target.checked ? "password" : "text";
});
