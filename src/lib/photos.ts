import { supabase } from "./supabase";

export async function getSignedPhotoUrl(
  storagePath: string,
  expiresSec = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("photos")
    .createSignedUrl(storagePath, expiresSec);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function uploadContactPhotos(
  userId: string,
  contactLogId: string,
  files: File[]
): Promise<void> {
  for (const file of files) {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${userId}/${contactLogId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("photos").upload(path, file, {
      contentType: file.type || "image/jpeg",
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

export async function deleteStoragePath(path: string): Promise<void> {
  const { error } = await supabase.storage.from("photos").remove([path]);
  if (error) throw error;
}
