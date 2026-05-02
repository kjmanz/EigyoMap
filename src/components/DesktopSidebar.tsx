import { NavLink } from "react-router-dom";
import type { AppHeaderActiveNav } from "./AppHeader";
import { PRIMARY_APP_NAV_ITEMS } from "./navItems";

type Props = { active: AppHeaderActiveNav | null };

export function DesktopSidebar({ active }: Props) {
  return (
    <aside
      aria-label="メインナビゲーション"
      className="hidden w-52 shrink-0 flex-col border-r border-gray-200 bg-gray-50 lg:flex lg:sticky lg:top-0 lg:h-[100dvh] lg:overflow-y-auto lg:overscroll-none"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="px-4 pb-2 pt-4">
        <NavLink to="/" className="text-lg font-bold tracking-tight text-accent">
          まちマップ
        </NavLink>
      </div>
      <nav className="flex flex-col gap-0.5 px-2 pb-4">
        {PRIMARY_APP_NAV_ITEMS.map(({ to, nav, label, Icon }) => {
          const isCurrent = active === nav;
          return (
            <NavLink
              key={nav}
              to={to}
              end={to === "/"}
              aria-current={isCurrent ? "page" : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white text-accent shadow-sm ring-1 ring-gray-200"
                    : "text-gray-600 hover:bg-white/70 hover:text-gray-900"
                }`
              }
            >
              <Icon className="h-5 w-5 shrink-0 opacity-90" />
              <span>{label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
