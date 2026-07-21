"use client";

import { useRef, useState } from "react";
import { authApi, getUser, setUser, type PublicUser } from "@/lib/api";
import { Avatar } from "@/components/Avatar";
import { showToast } from "@/lib/toast";

/**
 * Account card: display name + profile photo. The photo is resized to a small
 * square client-side (so uploads stay tiny) and stored as a data URL on the
 * user, replacing their initials avatar everywhere.
 */
export default function ProfileSettings() {
  const [user, setUserState] = useState<PublicUser | null>(getUser());
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = (u: PublicUser) => {
    setUserState(u);
    setUser(u); // persist to localStorage so the whole app reflects it
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await resizeToSquare(file, 256);
      const { user: updated } = await authApi.updateProfile({ avatarUrl: dataUrl });
      apply(updated);
      showToast("Profile photo updated.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't update your photo.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    try {
      const { user: updated } = await authApi.updateProfile({ avatarUrl: null });
      apply(updated);
      showToast("Photo removed.");
    } catch {
      showToast("Couldn't remove the photo.");
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <h3>Your profile</h3>
      </div>
      <div className="setting-row">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Avatar
            name={user.fullName || user.email}
            id={user.id}
            avatarUrl={user.avatarUrl}
            className="avatar-xl"
          />
          <div>
            <div className="setting-label">{user.fullName || "Your name"}</div>
            <div className="setting-hint">{user.email}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {user.avatarUrl && (
            <button type="button" className="btn btn-ghost" onClick={() => void remove()} disabled={busy}>
              Remove
            </button>
          )}
          <button
            type="button"
            className="btn btn-soft"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {busy ? <span className="spinner" /> : user.avatarUrl ? "Change photo" : "Upload photo"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => void onFile(e)}
          />
        </div>
      </div>
    </div>
  );
}

/** Read an image file, cover-crop to a centered square, and return a JPEG data URL. */
function resizeToSquare(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read the image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image couldn't be loaded."));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable."));
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
