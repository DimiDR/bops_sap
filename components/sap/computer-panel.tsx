"use client";

import { useEffect, useRef, useState } from "react";
import { CloseButton } from "@/components/app/ui";
import { frameUrl } from "./client";
import type { SapState } from "./types";

export function SapComputerPanel({
  state,
  busy,
  onClose,
  onTakeover,
  onInput,
}: {
  state: SapState | null;
  busy: boolean;
  onClose: () => void;
  onTakeover: () => void;
  onInput: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  const human = state?.mode === "human";
  const [connected, setConnected] = useState(false);
  const [typing, setTyping] = useState("");
  const [masked, setMasked] = useState(false);
  const frameRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = frameRef.current;
    if (!img) return;
    let cancelled = false;
    const bump = (ok: boolean) => {
      if (cancelled) return;
      setConnected(ok);
      window.setTimeout(() => {
        if (!cancelled && frameRef.current) frameRef.current.src = frameUrl();
      }, ok ? 400 : 1500);
    };
    const onLoad = () => bump(true);
    const onError = () => bump(false);
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
    img.src = frameUrl();
    return () => {
      cancelled = true;
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    };
  }, []);

  const status = connected ? (human ? "Live · Du steuerst" : "Live · Bot-Modus") : "Live-Bild nicht verfügbar";

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col bg-[#141412] text-[#F4F4F0]">
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold tracking-[-0.01em]">Computer</div>
          <p id="screen-status" aria-live="polite" className="mt-0.5 truncate text-[12px] text-[#9A9A98]">
            {status}
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] leading-4 text-[#C8C8C4]">
          {status.startsWith("Live") ? "Live" : "Offline"}
        </span>
        <button
          type="button"
          id="takeover"
          disabled={!state || busy}
          onClick={onTakeover}
          className="rounded-full bg-[#2A2A28] px-3 py-1.5 text-[12.5px] font-medium leading-4 text-[#F4F4F0] hover:bg-[#333331] disabled:opacity-50"
        >
          {human ? "An Bot zurückgeben" : "Übernehmen"}
        </button>
        <CloseButton onClick={onClose} className="border-0 bg-white/5 shadow-none hover:bg-white/10 [&_path]:stroke-[#F4F4F0]" />
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={frameRef}
          id="frame"
          width={1000}
          height={620}
          alt="Live-Ansicht der Testmaske"
          className={`w-full rounded-xl bg-black object-contain ${human && connected ? "cursor-crosshair outline outline-2 outline-[#A9D4FF]" : ""}`}
          onClick={(event) => {
            if (!human || !connected || !frameRef.current) return;
            const rect = frameRef.current.getBoundingClientRect();
            void onInput({
              type: "click",
              x: ((event.clientX - rect.left) / rect.width) * frameRef.current.naturalWidth,
              y: ((event.clientY - rect.top) / rect.height) * frameRef.current.naturalHeight,
            });
          }}
        />

        <form
          id="remote-text"
          hidden={!human}
          className="mt-4 space-y-2 rounded-2xl border border-white/10 bg-[#1C1C1A] p-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await onInput({ type: "text", text: typing })) setTyping("");
          }}
        >
          <label htmlFor="typing" className="block text-[12px] text-[#9A9A98]">
            Text an ausgewähltes Feld senden
          </label>
          <input
            id="typing"
            value={typing}
            onChange={(event) => setTyping(event.target.value)}
            maxLength={120}
            required
            type={masked ? "password" : "text"}
            disabled={busy || !connected}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-[#F4F4F0] outline-none placeholder:text-[#6B6B6B] focus:shadow-[0_0_0_1.5px_#F4F4F0]"
          />
          <label className="flex items-center gap-2 text-[12px] text-[#9A9A98]">
            <input id="masked-input" type="checkbox" checked={masked} onChange={(event) => setMasked(event.target.checked)} />
            Eingabe verdecken
          </label>
          <div className="flex flex-wrap gap-1.5">
            <button type="submit" disabled={busy || !connected} className="rounded-full bg-[#F4F4F0] px-3 py-1.5 text-[12.5px] font-medium text-[#0A0A0A] disabled:opacity-50">
              Text eingeben
            </button>
            <button
              type="button"
              id="backspace"
              disabled={busy || !connected}
              onClick={() => void onInput({ type: "key", key: "Backspace" })}
              className="rounded-full bg-[#2A2A28] px-3 py-1.5 text-[12.5px] font-medium text-[#F4F4F0] disabled:opacity-50"
            >
              Zeichen löschen
            </button>
            <button
              type="button"
              id="enter-key"
              disabled={busy || !connected}
              onClick={() => void onInput({ type: "key", key: "Enter" })}
              className="rounded-full bg-[#2A2A28] px-3 py-1.5 text-[12.5px] font-medium text-[#F4F4F0] disabled:opacity-50"
            >
              Enter senden
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
