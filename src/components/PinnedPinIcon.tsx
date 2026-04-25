type Props = {
  /** 一覧は sm、カード見出しは md */
  size?: "sm" | "md";
  className?: string;
};

/** ピン留め中の目印（赤い地図ピン） */
export function PinnedPinIcon({ size = "sm", className = "" }: Props) {
  const wh = size === "md" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center text-red-600 ${className}`}
      title="ピン留め中"
      aria-label="ピン留め中"
      role="img"
    >
      <svg className={`${wh} drop-shadow-sm`} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
          fill="currentColor"
        />
        <circle cx="12" cy="9" r="2.25" fill="white" fillOpacity="0.95" />
      </svg>
    </span>
  );
}
