import { useEffect } from "react";
import { flushOfflineQueue } from "../lib/offline";
import { useAuth } from "../contexts/AuthContext";

/** オンライン復帰時にオフラインキューを自動同期 */
export function OnlineSync() {
  const { user, configured } = useAuth();

  useEffect(() => {
    if (!configured || !user) return;

    const run = () => {
      if (!navigator.onLine) return;
      void flushOfflineQueue();
    };

    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [user, configured]);

  return null;
}
