"use client";

import { useEffect, useRef } from "react";
import { ComposerInput } from "@/components/app/composer-input";
import { Mascot } from "@/components/app/mascot";
import { SideToggleIcon } from "@/components/app/ui";
import { PlatformProvider } from "@/components/message-ui/platform";
import { TypingIndicator } from "@/components/message-ui/typing-indicator";
import { SapApprovalCard } from "./approval-card";
import type { SapChatItem, SapState } from "./types";

const BOT_ID = "sap-grokbot";
const BOT_COLOR = "#3D7EFF";

const eventLabels: Record<string, string> = {
  proposed: "Vorgeschlagen",
  rejected: "Abgelehnt",
  invalidated: "Durch Übernehmen ungültig",
  stale: "Ausgangswert geändert",
  approved: "Freigegeben",
  unconfirmed: "Ergebnis ungeklärt",
  saved: "Gespeichert",
};

export function SapChatPanel({
  state,
  items,
  busy,
  draft,
  model,
  auditOpen,
  onDraft,
  onModel,
  onSend,
  onRead,
  onApprove,
  onReject,
  onToggleAudit,
  onToggleComputer,
  computerOpen,
}: {
  state: SapState | null;
  items: SapChatItem[];
  busy: boolean;
  draft: string;
  model: string;
  auditOpen: boolean;
  onDraft: (value: string) => void;
  onModel: (value: string) => void;
  onSend: () => void;
  onRead: () => void;
  onApprove: () => void;
  onReject: () => void;
  onToggleAudit: () => void;
  onToggleComputer: () => void;
  computerOpen: boolean;
}) {
  const human = state?.mode === "human";
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [items, busy, state?.pending]);

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col bg-[#0C0C0B] text-[#F4F4F0]">
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <Mascot botId={BOT_ID} color={BOT_COLOR} size={28} />
        <div className="min-w-0 flex-1">
          <h1 id="chat-title" className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            {state?.orderLabel || "Auftrag an den Bot"}
          </h1>
          <p className="truncate text-[12px] text-[#8A8A88]">Chat · Freigaben im Verlauf</p>
        </div>
        <button
          type="button"
          onClick={onToggleAudit}
          className="rounded-full bg-white/5 px-3 py-1.5 text-[12px] font-medium text-[#C8C8C4] hover:bg-white/10"
        >
          Freigabeprotokoll
        </button>
        <button
          type="button"
          aria-label={computerOpen ? "Computer ausblenden" : "Computer einblenden"}
          onClick={onToggleComputer}
          className="flex size-8 items-center justify-center rounded-full bg-white/5 hover:bg-white/10"
        >
          <span className="[&_rect]:stroke-[#C8C8C4] [&_path]:stroke-[#C8C8C4] [&_rect[fill]]:fill-[#C8C8C4]">
            <SideToggleIcon side="right" open={computerOpen} />
          </span>
        </button>
      </header>

      <div id="messages" ref={logRef} role="log" aria-label="Chatverlauf" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {items.map((item) => {
          if (item.kind === "approval") {
            return (
              <div key={item.id} className="flex justify-start">
                {item.resolved ? (
                  <div className="rounded-2xl border border-white/10 bg-[#1C1C1A] px-3 py-2 text-[12.5px] text-[#9A9A98]">
                    Freigabe {item.resolved === "approved" ? "gespeichert" : item.resolved}
                  </div>
                ) : state?.pending?.id === item.pending.id ? (
                  <SapApprovalCard pending={item.pending} busy={busy} onApprove={onApprove} onReject={onReject} />
                ) : null}
              </div>
            );
          }
          const mine = item.role === "user";
          return (
            <div key={item.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[min(100%,520px)] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-[20px] [overflow-wrap:anywhere] ${
                  item.role === "error"
                    ? "bg-[#3A1820] text-[#FFB4B4]"
                    : mine
                      ? "bg-[#2F5BFF] text-white"
                      : "bg-[#1C1C1A] text-[#F4F4F0] shadow-[0_0_0_1px_#FFFFFF14]"
                } ${item.role === "bot" ? "bot" : item.role === "user" ? "user" : "error"}`}
              >
                {item.role === "bot" && item.id === "introduction" ? <span id="introduction">{item.text}</span> : item.text}
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="flex justify-start pt-1">
            <PlatformProvider platform="macos">
              <TypingIndicator label="Bot arbeitet" className="scale-95" />
            </PlatformProvider>
          </div>
        )}
      </div>

      {auditOpen && (
        <div className="border-t border-white/10 bg-[#121210] px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">Freigabeprotokoll</h2>
            <button type="button" onClick={onToggleAudit} className="text-[12px] text-[#8A8A88] hover:text-[#F4F4F0]">
              Schließen
            </button>
          </div>
          <p className="mb-2 text-[12px] text-[#8A8A88]">Ereignisse mit Korrelations-ID für diese Demo-Sitzung.</p>
          <ol id="audit-events" className="max-h-40 space-y-1 overflow-y-auto text-[12px] text-[#C8C8C4]">
            {(state?.audit ?? []).map((entry) => (
              <li key={`${entry.id}-${entry.event}-${entry.at}`}>
                {new Date(entry.at).toLocaleTimeString("de-DE")} · {eventLabels[entry.event] || entry.event} · {entry.id}
              </li>
            ))}
          </ol>
        </div>
      )}

      <form
        id="composer"
        className="border-t border-white/10 bg-[#10100F] px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <label htmlFor="model" className="mb-1 block text-[12px] text-[#8A8A88]">
          Auftragsverarbeitung
        </label>
        <select
          id="model"
          value={model}
          onChange={(event) => onModel(event.target.value)}
          disabled={!state || busy || human}
          className="mb-2 w-full rounded-xl border border-white/10 bg-[#1C1C1A] px-3 py-2 text-[13px] text-[#F4F4F0] outline-none disabled:opacity-50"
        >
          <option value="">Lokale Befehle</option>
          {(state?.modelIds ?? []).map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <label htmlFor="task" className="mb-1 block text-[12px] text-[#8A8A88]">
          Nachricht
        </label>
        <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-[#1C1C1A] px-3 py-2 shadow-[0_0_0_1px_#FFFFFF0A]">
          <ComposerInput
            id="task"
            value={draft}
            onChange={onDraft}
            maxLength={200}
            required
            disabled={!state || busy || human}
            placeholder={state?.writable === false ? "Notiz lesen" : "Notiz ändern: Lieferung bestätigt"}
            className="min-h-[24px] flex-1 bg-transparent text-[14px] leading-5 text-[#F4F4F0] outline-none placeholder:text-[#6B6B6B] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!state || busy || human || !draft.trim()}
            className="rounded-full bg-[#F4F4F0] px-3 py-1.5 text-[12.5px] font-medium text-[#0A0A0A] disabled:opacity-50"
          >
            Senden
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            id="read"
            disabled={!state || busy || human}
            onClick={onRead}
            className="rounded-full bg-[#2A2A28] px-3 py-1.5 text-[12.5px] font-medium text-[#F4F4F0] hover:bg-[#333331] disabled:opacity-50"
          >
            Notiz lesen
          </button>
        </div>
      </form>
    </section>
  );
}
