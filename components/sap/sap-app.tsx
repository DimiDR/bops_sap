"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatEdge, CHAT_WIDTH, gridColumns, storedChatWidth } from "@/components/app/chat-edge";
import { fetchSapState, postSapAction } from "./client";
import { SapChatPanel } from "./chat-panel";
import { SapComputerPanel } from "./computer-panel";
import { SapSidebar } from "./sidebar";
import type { SapChatItem, SapState } from "./types";

/**
 * SAP GrokBot shell: Bops layout (sidebar · chat · computer) wired to `/api/sap/*`,
 * which runs the sap-grokbot worker/session backend. Intentionally a dedicated route
 * instead of forcing AppState into BopsApp — same look, SAP security model intact.
 */
export function SapGrokBotApp() {
  const [state, setState] = useState<SapState | null>(null);
  const [items, setItems] = useState<SapChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [computerOpen, setComputerOpen] = useState(true);
  const [auditOpen, setAuditOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(CHAT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const sidebarWidth = sidebarOpen ? 260 : 0;

  useEffect(() => {
    setChatWidth(storedChatWidth());
  }, []);

  const syncIntroduction = useCallback((next: SapState) => {
    const text = next.writable
      ? `${next.orderLabel}: Ich kann die Notiz lesen und nach deiner Freigabe ändern.`
      : `${next.orderLabel}: Ich kann die Notiz lesen.`;
    setItems((prev) => {
      const rest = prev.filter((item) => !(item.kind === "message" && item.id === "introduction"));
      return [{ kind: "message", id: "introduction", role: "bot", text }, ...rest];
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSapState()
      .then((next) => {
        if (cancelled) return;
        setState(next);
        syncIntroduction(next);
        if (next.pending) {
          setItems((prev) => {
            if (prev.some((item) => item.kind === "approval" && item.pending.id === next.pending!.id)) return prev;
            return [...prev, { kind: "approval", id: `a-${next.pending!.id}`, pending: next.pending! }];
          });
        }
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setItems([{ kind: "message", id: "boot-error", role: "error", text: error.message }]);
      });
    return () => {
      cancelled = true;
    };
  }, [syncIntroduction]);

  const send = useCallback(
    async (command: Record<string, unknown>, opts?: { echoUser?: boolean }) => {
      if (busy || !state) return false;
      setBusy(true);
      if (opts?.echoUser && typeof command.text === "string") {
        setItems((prev) => [...prev, { kind: "message", id: `u-${Date.now()}`, role: "user", text: command.text as string }]);
      }
      try {
        const next = await postSapAction(command);
        setState(next);
        if (command.action === "message" && next.pending) {
          setItems((prev) => [
            ...prev,
            ...(next.message ? [{ kind: "message" as const, id: `b-${Date.now()}`, role: "bot" as const, text: next.message! }] : []),
            { kind: "approval", id: `a-${next.pending.id}`, pending: next.pending },
          ]);
        } else if (next.message) {
          setItems((prev) => [...prev, { kind: "message", id: `b-${Date.now()}`, role: "bot", text: next.message! }]);
        }
        if (command.action === "approve" || command.action === "reject") {
          const id = typeof command.id === "string" ? command.id : "";
          setItems((prev) =>
            prev.map((item) =>
              item.kind === "approval" && item.pending.id === id
                ? { ...item, resolved: command.action === "approve" ? "approved" : "rejected" }
                : item,
            ),
          );
        }
        if (command.action === "mode" && command.mode === "human") {
          setItems((prev) =>
            prev.map((item) => (item.kind === "approval" && !item.resolved ? { ...item, resolved: "invalidated" } : item)),
          );
        }
        return true;
      } catch (error) {
        const err = error as Error & { state?: SapState };
        if (err.state) setState(err.state);
        setItems((prev) => [...prev, { kind: "message", id: `e-${Date.now()}`, role: "error", text: err.message }]);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, state],
  );

  const columns = useMemo(
    () => gridColumns(sidebarWidth, computerOpen ? chatWidth : null),
    [sidebarWidth, computerOpen, chatWidth],
  );

  return (
    <div className="dark flex h-dvh min-h-0 flex-col bg-[#0A0A09] text-[#F4F4F0]">
      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: columns, transition: dragging ? undefined : "grid-template-columns 180ms ease" }}
      >
        {sidebarOpen && (
          <SapSidebar
            state={state}
            chatTitle={state?.orderLabel || "Auftrag"}
            onNewChat={() => {
              setItems((prev) => prev.filter((item) => item.kind === "message" && item.id === "introduction"));
              if (state) syncIntroduction(state);
            }}
            onCollapse={() => setSidebarOpen(false)}
          />
        )}

        <div className="relative min-h-0 min-w-0">
          {!sidebarOpen && (
            <button
              type="button"
              aria-label="Seitenleiste einblenden"
              onClick={() => setSidebarOpen(true)}
              className="absolute left-3 top-3 z-20 rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-[#F4F4F0]"
            >
              Menü
            </button>
          )}
          <SapChatPanel
            state={state}
            items={items}
            busy={busy}
            draft={draft}
            model={model}
            auditOpen={auditOpen}
            onDraft={setDraft}
            onModel={setModel}
            onSend={async () => {
              if (await send({ action: "message", text: draft, model }, { echoUser: true })) setDraft("");
            }}
            onRead={() => void send({ action: "message", text: "Notiz lesen" }, { echoUser: true })}
            onApprove={() => void send({ action: "approve", id: state?.pending?.id })}
            onReject={() => void send({ action: "reject", id: state?.pending?.id })}
            onToggleAudit={() => setAuditOpen((open) => !open)}
            onToggleComputer={() => setComputerOpen((open) => !open)}
            computerOpen={computerOpen}
          />
          {computerOpen && (
            <ChatEdge from={sidebarWidth} width={chatWidth} onWidth={setChatWidth} onDragging={setDragging} />
          )}
        </div>

        {computerOpen && (
          <SapComputerPanel
            state={state}
            busy={busy}
            onClose={() => setComputerOpen(false)}
            onTakeover={() =>
              void send({
                action: "mode",
                mode: state?.mode === "human" ? "bot" : "human",
              })
            }
            onInput={(input) => send({ action: "input", input })}
          />
        )}
      </div>
    </div>
  );
}
