import { supabase } from "./supabase";
import type { CustomerRow } from "./types";

const DB_NAME = "machimap-offline";
const DB_VERSION = 1;
const QUEUE_STORE = "queue";

export type OfflineCustomerPayload = {
  name: string;
  address: string | null;
  phone: string | null;
  memo: string | null;
  lat: number;
  lng: number;
  labelIds: string[];
};

export type OfflineContactPayload = {
  customerId: string;
  memo: string;
  visitedAt: string;
  photoBlobs: { name: string; type: string; dataBase64: string }[];
};

export type QueueRecord =
  | {
      id: string;
      kind: "customer";
      createdAt: number;
      payload: OfflineCustomerPayload;
    }
  | {
      id: string;
      kind: "contact_log";
      createdAt: number;
      payload: OfflineContactPayload;
    };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      }
    };
  });
}

export async function enqueueOffline(item: Omit<QueueRecord, "createdAt">): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, "readwrite");
  const rec = { ...item, createdAt: Date.now() } as QueueRecord;
  tx.objectStore(QUEUE_STORE).put(rec);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listQueue(): Promise<QueueRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () =>
      resolve((req.result as QueueRecord[]).sort((a, b) => a.createdAt - b.createdAt));
    req.onerror = () => reject(req.error);
  });
}

export async function removeQueueItem(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, "readwrite");
  tx.objectStore(QUEUE_STORE).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function uploadPhotosForLog(
  contactLogId: string,
  userId: string,
  photos: OfflineContactPayload["photoBlobs"]
): Promise<void> {
  for (const p of photos) {
    const bin = Uint8Array.from(atob(p.dataBase64), (c) => c.charCodeAt(0));
    const path = `${userId}/${contactLogId}/${crypto.randomUUID()}-${p.name}`;
    const { error: upErr } = await supabase.storage.from("photos").upload(path, bin, {
      contentType: p.type || "image/jpeg",
      upsert: false,
    });
    if (upErr) throw upErr;
    const { error: insErr } = await supabase.from("photos").insert({
      contact_log_id: contactLogId,
      storage_path: path,
    });
    if (insErr) throw insErr;
  }
}

export async function flushOfflineQueue(
  onProgress?: (msg: string) => void
): Promise<{ ok: number; err: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: 0, err: "未ログインです" };

  const items = await listQueue();
  let ok = 0;
  for (const item of items) {
    try {
      if (item.kind === "customer") {
        onProgress?.("顧客を同期中…");
        const p = item.payload;
        const { data: row, error } = await supabase
          .from("customers")
          .insert({
            user_id: user.id,
            name: p.name,
            address: p.address,
            phone: p.phone,
            memo: p.memo,
            lat: p.lat,
            lng: p.lng,
          })
          .select("id")
          .single();
        if (error) throw error;
        const customerId = (row as Pick<CustomerRow, "id">).id;
        for (const lid of p.labelIds) {
          const { error: e2 } = await supabase.from("customer_labels").insert({
            customer_id: customerId,
            label_id: lid,
          });
          if (e2) throw e2;
        }
        await removeQueueItem(item.id);
        ok++;
      } else if (item.kind === "contact_log") {
        onProgress?.("訪問メモを同期中…");
        const p = item.payload;
        const { data: logRow, error } = await supabase
          .from("contact_logs")
          .insert({
            customer_id: p.customerId,
            user_id: user.id,
            memo: p.memo,
            visited_at: p.visitedAt,
            pinned: false,
          })
          .select("id")
          .single();
        if (error) throw error;
        const logId = logRow.id as string;
        if (p.photoBlobs.length > 0) {
          await uploadPhotosForLog(logId, user.id, p.photoBlobs);
        }
        await removeQueueItem(item.id);
        ok++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok, err: msg };
    }
  }
  return { ok, err: null };
}

export function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}
