import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SAP GrokBot",
  description: "SAP GrokBot — Chat, Freigaben und Bot-Browser.",
};

export default function SapLayout({ children }: { children: React.ReactNode }) {
  return <div className="dark min-h-dvh bg-[#0A0A09] text-[#F4F4F0]">{children}</div>;
}
