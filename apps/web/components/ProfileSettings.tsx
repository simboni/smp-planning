"use client";

import { useRef, useState } from "react";
import { ApiError, authApi, getUser, setUser, type PublicUser } from "@/lib/api";
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
  const [name, setName] = useState(getUser()?.fullName ?? "");
  const [savingName, setSavingName] = useState(false);
  // Shown for information: dates follow this device's timezone.
  const timezone =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

  const saveName = async (): Promise<void> => {
    const n = name.trim();
    if (!n || !user || n === user.fullName) return;
    setSavingName(true);
    try {
      const { user: updated } = await authApi.updateProfile({ fullName: n });
      apply(updated);
      showToast("Name updated.");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Couldn't update your name.");
    } finally {
      setSavingName(false);
    }
  };

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

      <div className="setting-row">
        <div>
          <label className="setting-label" htmlFor="profile-name">Name</label>
          <div className="setting-hint">How you appear to your teammates.</div>
        </div>
        <form
          className="profile-inline"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <input
            id="profile-name"
            className="input"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-soft"
            disabled={savingName || !name.trim() || name.trim() === user.fullName}
          >
            {savingName ? <span className="spinner" /> : "Save"}
          </button>
        </form>
      </div>

      {timezone && (
        <div className="setting-row">
          <div>
            <div className="setting-label">Timezone</div>
            <div className="setting-hint">
              Times show in this device&apos;s timezone. Due dates and &ldquo;overdue&rdquo; follow
              the workspace&apos;s calendar day (Nairobi).
            </div>
          </div>
          <span>{timezone.replace(/_/g, " ")}</span>
        </div>
      )}
    </div>
  );
}

/** Change password (Settings → Account). */
export function PasswordSettings() {
  const user = getUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");
    if (next.length < 8) return setError("New password must be at least 8 characters.");
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    try {
      await authApi.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      showToast("Password changed. Your other devices were signed out.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change your password.");
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async (): Promise<void> => {
    if (!user) return;
    try {
      await authApi.forgotPassword(user.email);
      showToast(`A reset link is on its way to ${user.email}.`);
    } catch {
      showToast("Couldn't send the reset email. Try again in a moment.");
    }
  };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <h3>Password</h3>
      </div>
      <form className="password-form" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span className="label">Current password</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="label">New password</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="label">Confirm new password</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="password-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void sendReset()}>
            Forgot it? Email me a reset link
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : "Change password"}
          </button>
        </div>
        <p className="setting-hint" style={{ margin: 0 }}>
          Signed up with Google? Use the reset link to set a password.
        </p>
      </form>
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
