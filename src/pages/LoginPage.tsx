import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function LoginPage() {
  const { signIn, signUp, configured } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const fn = mode === "login" ? signIn : signUp;
      const { error } = await fn(email.trim(), password);
      if (error) {
        setErr(error.message);
        return;
      }
      nav("/", { replace: true });
    } finally {
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
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="text-sm text-gray-700">
          メール
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="text-sm text-gray-700">
          パスワード
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-accent py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "処理中…" : mode === "login" ? "ログイン" : "新規登録"}
        </button>
      </form>
      <button
        type="button"
        className="text-sm text-accent underline"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
      >
        {mode === "login" ? "新規登録はこちら" : "ログインに戻る"}
      </button>
    </div>
  );
}
