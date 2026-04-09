import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

/** 共通ナビのボタン見た目（サブヘッダーの戻るなどでも使用） */
export const APP_HEADER_NAV_CLASS =
  "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-800 shadow-sm active:bg-gray-100";

const NAV_CURRENT_CLASS =
  "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border border-accent bg-accent/10 px-3 text-sm font-semibold text-accent shadow-sm ring-1 ring-accent/25";

function navClass(current: boolean): string {
  return current ? NAV_CURRENT_CLASS : APP_HEADER_NAV_CLASS;
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z"
      />
    </svg>
  );
}

export type AppHeaderActiveNav = "map" | "list" | "today" | "settings";

export type AppHeaderSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** `<datalist id={listId}>…</datalist>` 用 */
  listId?: string;
  datalist?: ReactNode;
};

type AppHeaderMainProps = {
  variant: "main";
  title: string;
  /** いまのページに応じてナビの強調。ゴミ箱などナビのみのときは null */
  activeNav: AppHeaderActiveNav | null;
  /** 設定リンクの直後・検索アイコンの前（例: 地図の「現在地」） */
  navTrailing?: ReactNode;
  search?: AppHeaderSearchProps;
  /** 検索欄内の右側（通常は未使用） */
  searchTrailing?: ReactNode;
  /** タイトル行の下（例: 今日のまとめの日付） */
  children?: ReactNode;
};

type AppHeaderBackProps = {
  variant: "back";
  title: string;
  onBack: () => void;
  /** 右端（例: 地図リンク） */
  rightSlot?: ReactNode;
};

export type AppHeaderProps = AppHeaderMainProps | AppHeaderBackProps;

export function AppHeader(props: AppHeaderProps) {
  if (props.variant === "back") {
    return (
      <header className="sticky top-0 z-10 shrink-0 border-b border-gray-200 bg-white px-2 py-2 sm:px-3">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button type="button" className={APP_HEADER_NAV_CLASS} onClick={props.onBack}>
            戻る
          </button>
          <h1 className="min-w-0 flex-1 truncate text-center text-base font-semibold text-gray-800 sm:text-lg">
            {props.title}
          </h1>
          {props.rightSlot ? (
            <div className="flex max-w-[45%] shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
              {props.rightSlot}
            </div>
          ) : null}
        </div>
      </header>
    );
  }

  return <AppHeaderMain {...props} />;
}

function AppHeaderMain({
  title,
  activeNav,
  navTrailing,
  search,
  searchTrailing,
  children,
}: AppHeaderMainProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const q = search?.value ?? "";

  useEffect(() => {
    if (!searchOpen || !search) return;
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [searchOpen, search]);

  const showListLink = activeNav !== "list";

  return (
    <header className="sticky top-0 z-10 shrink-0 border-b border-gray-200 bg-white px-2 py-2 sm:px-3">
      <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2">
        <Link to="/" className={navClass(activeNav === "map")} aria-current={activeNav === "map" ? "page" : undefined}>
          地図
        </Link>
        {showListLink && (
          <Link to="/list" className={navClass(false)}>
            一覧
          </Link>
        )}
        <h1 className="min-w-0 flex-1 truncate text-center text-base font-semibold text-gray-800 sm:text-lg">
          {title}
        </h1>
        <Link
          to="/today"
          className={navClass(activeNav === "today")}
          aria-current={activeNav === "today" ? "page" : undefined}
        >
          今日
        </Link>
        <Link
          to="/settings"
          className={navClass(activeNav === "settings")}
          aria-current={activeNav === "settings" ? "page" : undefined}
        >
          設定
        </Link>
        {navTrailing}
        {search && (
          <button
            type="button"
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border shadow-sm md:hidden ${
              searchOpen || q.trim()
                ? "border-accent bg-accent/10 text-accent"
                : "border-gray-200 bg-gray-50 text-gray-700 active:bg-gray-100"
            }`}
            aria-expanded={searchOpen}
            aria-label={searchOpen ? "検索を閉じる" : "検索を開く"}
            onClick={() => setSearchOpen((o) => !o)}
          >
            <SearchIcon className="h-[22px] w-[22px]" />
          </button>
        )}
      </div>

      {search && (
        <div
          className={`mt-2 items-center gap-2 ${searchOpen ? "flex" : "hidden md:flex"}`}
        >
          <input
            ref={searchInputRef}
            type="search"
            placeholder={search.placeholder ?? "名前で検索"}
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            className="min-h-[44px] w-full flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base md:text-sm"
            enterKeyHint="search"
            list={search.listId}
          />
          {search.datalist}
          {searchTrailing}
          {searchOpen && (
            <button
              type="button"
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-600 md:hidden"
              onClick={() => setSearchOpen(false)}
            >
              閉じる
            </button>
          )}
        </div>
      )}

      {children}
    </header>
  );
}
