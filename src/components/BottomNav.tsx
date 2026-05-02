import { Link } from "react-router-dom";
import type { AppHeaderActiveNav } from "./AppHeader";
import { PRIMARY_APP_NAV_ITEMS } from "./navItems";

type Props = { active: AppHeaderActiveNav | null };

export function BottomNav({ active }: Props) {
  return (
    <nav
      aria-label="メインナビゲーション（モバイル）"
      className="fixed bottom-0 left-0 right-0 z-[2000] border-t border-gray-200 bg-white lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex h-14 items-stretch">
        {PRIMARY_APP_NAV_ITEMS.map(({ to, nav, label, Icon }) => {
          const isCurrent = active === nav;
          return (
            <Link
              key={nav}
              to={to}
              aria-current={isCurrent ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                isCurrent ? "text-accent" : "text-gray-500 active:text-gray-800"
              }`}
            >
              <Icon />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
