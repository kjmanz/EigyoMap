import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

function buildLoginRedirectTo(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}login`;
}

export function LoginPage() {
  const { user, loading, signInWithGoogle, configured } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      nav("/", { replace: true });
    }
  }, [loading, nav, user]);

  async function loginWithGoogle() {
    setErr(null);
    setBusy(true);
    try {
      const { error } = await signInWithGoogle(buildLoginRedirectTo());
      if (error) {
        setErr(error.message);
        setBusy(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Google ログインに失敗しました");
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <h1 className="text-xl font-semibold text-gray-800">まちマップ</h1>
        <p className="text-sm text-gray-600">
          Supabase が未設定です。プロジェクト直下に{" "}
          <code className="rounded bg-gray-100 px-1">.env</code> を作成し、
          <code className="rounded bg-gray-100 px-1">VITE_SUPABASE_URL</code> と{" "}
          <code className="rounded bg-gray-100 px-1">VITE_SUPABASE_ANON_KEY</code>{" "}
          を設定してください（.env.example を参照）。
        </p>
        <Link to="/" className="text-accent text-sm underline">
          地図を試す（オフライン表示のみ）
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-800">まちマップ</h1>
        <p className="mt-1 text-sm text-gray-500">フィールド営業マップ CRM</p>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button
        type="button"
        onClick={() => void loginWithGoogle()}
        disabled={busy}
        className="flex w-full items-center justify-center gap-3 rounded border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-800 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[conic-gradient(#ea4335_0_25%,#fbbc05_25%_50%,#34a853_50%_75%,#4285f4_75%_100%)]">
          <span className="h-3 w-3 rounded-full bg-white" />
        </span>
        {busy ? "接続中…" : "Google でログイン"}
      </button>
    </div>
  );
}
