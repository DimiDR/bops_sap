"use client";

import type { SapPending } from "./types";

/**
 * Inline Freigabe-Karte im Chat — optisch an Bops' AppApprovalCard angelehnt
 * (gerundete Karte, Alt/Neu, Allow/Deny), Texte und Aktionen bleiben SAP-spezifisch.
 */
export function SapApprovalCard({
  pending,
  busy,
  onApprove,
  onReject,
}: {
  pending: SapPending;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const btn = "rounded-full px-3 py-1.5 text-[12.5px] font-medium leading-4 disabled:opacity-50";
  return (
    <div className="my-2 max-w-[min(100%,420px)] rounded-2xl border border-white/10 bg-[#1C1C1A] p-3.5 shadow-[0_10px_30px_-16px_#000000A0]">
      <div className="text-[13.5px] font-semibold leading-[18px] text-[#F4F4F0]">Änderung freigeben</div>
      <p className="mt-1 text-[12px] leading-4 text-[#9A9A98]">Prüfe Alt und Neu, bevor der Bot speichert.</p>
      <dl className="mt-3 space-y-2">
        <div>
          <dt className="text-[11px] uppercase tracking-[0.04em] text-[#8A8A88]">Aktuell</dt>
          <dd className="mt-0.5 whitespace-pre-wrap rounded-xl bg-black/25 px-3 py-2 text-[13px] leading-[18px] text-[#D8D8D4] [overflow-wrap:anywhere]">
            {pending.previous}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.04em] text-[#8A8A88]">Vorschlag</dt>
          <dd className="mt-0.5 whitespace-pre-wrap rounded-xl bg-[#2A2A28] px-3 py-2 text-[13px] leading-[18px] text-[#F4F4F0] [overflow-wrap:anywhere]">
            {pending.proposed}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5" data-ask-buttons>
        <button type="button" disabled={busy} onClick={onReject} id="reject" className={`${btn} bg-[#2A2A28] text-[#F4F4F0] hover:bg-[#333331]`}>
          Ablehnen
        </button>
        <button type="button" disabled={busy} onClick={onApprove} id="approve" className={`${btn} bg-[#F4F4F0] text-[#0A0A0A]`}>
          Freigeben und speichern
        </button>
      </div>
    </div>
  );
}
