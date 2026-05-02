import type { ReactNode } from "react";
import type { AppHeaderActiveNav } from "./AppHeader";
import { DesktopSidebar } from "./DesktopSidebar";

type Props = {
  sidebarActive: AppHeaderActiveNav | null;
  /** ビューポート高さに固定（地図・顧客詳細など） */
  fullViewportHeight?: boolean;
  children: ReactNode;
};

export function DesktopAppShell({ sidebarActive, fullViewportHeight, children }: Props) {
  if (fullViewportHeight) {
    return (
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white lg:flex-row">
        <DesktopSidebar active={sidebarActive} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-white lg:min-h-0 lg:flex-row">
      <DesktopSidebar active={sidebarActive} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
