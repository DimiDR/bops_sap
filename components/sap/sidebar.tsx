"use client";

import { Mascot } from "@/components/app/mascot";
import { SideToggleIcon } from "@/components/app/ui";
import type { SapState } from "./types";

const BOT_ID = "sap-grokbot";
const BOT_COLOR = "#3D7EFF";

export function SapSidebar({
  state,
  chatTitle,
  onNewChat,
  onCollapse,
}: {
  state: SapState | null;
  chatTitle: string;
  onNewChat: () => void;
  onCollapse?: () => void;
}) {
  const identity = state?.identity || (state?.authMode === "none" ? "local-test" : "Entra-Benutzer");
  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r border-white/10 bg-[#10100F] text-[#F4F4F0]">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold tracking-[-0.02em]">SAP GrokBot</div>
          <div id="environment-label" className="mt-0.5 truncate text-[11px] text-[#8A8A88]">
            {state?.environmentLabel || "Verbindung wird aufgebaut"}
          </div>
        </div>
        {onCollapse && (
          <button
            type="button"
            aria-label="Seitenleiste einklappen"
            onClick={onCollapse}
            className="flex size-8 items-center justify-center rounded-full bg-white/5 hover:bg-white/10"
          >
            <span className="[&_rect]:stroke-[#C8C8C4] [&_path]:stroke-[#C8C8C4] [&_rect[fill]]:fill-[#C8C8C4]">
              <SideToggleIcon side="left" open />
            </span>
          </button>
        )}
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[#F4F4F0] px-3 py-2 text-[13px] font-medium text-[#0A0A0A] hover:bg-white"
        >
          Neuer Chat
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-2xl bg-white/8 px-3 py-2.5 text-left shadow-[0_0_0_1px_#FFFFFF14]"
        >
          <Mascot botId={BOT_ID} color={BOT_COLOR} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium">{chatTitle}</div>
            <div className="truncate text-[12px] text-[#8A8A88]">Bot-Browser · Freigaben</div>
          </div>
        </button>
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.04em] text-[#6B6B6B]">Angemeldet</div>
        <div id="sap-identity" className="mt-1 truncate text-[13px] font-medium text-[#F4F4F0]">
          {identity}
        </div>
        <div className="mt-0.5 text-[11px] text-[#8A8A88]">
          {state?.authMode === "none" ? "Lokaler Testmodus" : "Entra ID"}
        </div>
      </div>
    </aside>
  );
}
