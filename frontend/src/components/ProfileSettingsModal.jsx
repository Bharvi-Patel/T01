// ProfileSettingsModal.jsx — opened from the account popup at the bottom of
// the Sidebar. Covers the user's own login identity: avatar, username/
// email, timezone, password change, and account deletion. Distinct from
// settings.jsx, which manages social accounts (LinkedIn/Facebook/etc) a
// draft can be published to.
import { useEffect, useRef, useState } from "react";
import { updateProfile, uploadAvatar, changePassword, deleteAccount } from "../api";

// A reasonably short, curated list rather than every IANA zone - covers the
// common regions without turning the select into an unscrollable wall.
const USERNAME_PATTERN = /^[a-z0-9_]{3,64}$/;

const TIMEZONES = [
  "UTC",
  "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
  "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Europe/Moscow", "Africa/Cairo", "Africa/Lagos", "Asia/Dubai", "Asia/Karachi",
  "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok", "Asia/Singapore", "Asia/Shanghai",
  "Asia/Tokyo", "Asia/Seoul", "Australia/Sydney", "Pacific/Auckland",
];

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

export default function ProfileSettingsModal({ token, profile, onClose, onProfileUpdated, onAccountDeleted }) {
  const [username, setUsername] = useState(profile?.username || "");
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [email, setEmail] = useState(profile?.email || "");
  const [tz, setTz] = useState(profile?.timezone || "UTC");
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoMessage, setInfoMessage] = useState(null); // { type, text }

  // profile is fetched async (GET /me) and can still be null/stale on the
  // first render if this modal mounts before that resolves - useState's
  // initial value only applies once, so without this the fields would stay
  // blank forever even after profile shows up. Re-sync whenever it changes.
  useEffect(() => {
    if (!profile) return;
    setUsername(profile.username || "");
    setFullName(profile.full_name || "");
    setEmail(profile.email || "");
    setTz(profile.timezone || "UTC");
  }, [profile]);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const fileInputRef = useRef(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function handleAvatarPick(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setAvatarError("");
    setAvatarUploading(true);
    try {
      const updated = await uploadAvatar({ token, file });
      onProfileUpdated(updated);
    } catch (err) {
      setAvatarError(err.message || "Could not upload photo.");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleSaveInfo(e) {
    e.preventDefault();
    setInfoSaving(true);
    setInfoMessage(null);
    try {
      const updated = await updateProfile({ token, username, fullName, email, timezone: tz });
      onProfileUpdated(updated);
      setInfoMessage({ type: "success", text: "Saved." });
    } catch (err) {
      setInfoMessage({ type: "error", text: err.message || "Could not save changes." });
    } finally {
      setInfoSaving(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: "error", text: "New passwords don't match." });
      return;
    }
    setPasswordSaving(true);
    setPasswordMessage(null);
    try {
      await changePassword({ token, currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage({ type: "success", text: "Password updated." });
    } catch (err) {
      setPasswordMessage({ type: "error", text: err.message || "Could not update password." });
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteAccount({ token, password: deletePassword });
      onAccountDeleted();
    } catch (err) {
      setDeleteError(err.message || "Could not delete account.");
    } finally {
      setDeleting(false);
    }
  }

  const hasPassword = profile?.has_password !== false;
  const deleteReady = hasPassword ? deletePassword.length > 0 : deleteConfirmText === "DELETE";

  return (
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-modal-header">
          <span>Profile settings</span>
          <button className="profile-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="profile-modal-body">
          {/* Avatar */}
          <div className="profile-modal-avatar-row">
            <span className="profile-modal-avatar">
              {profile?.avatar_url
                ? <img src={profile.avatar_url} alt="" />
                : <span>{initials(profile?.full_name || profile?.username)}</span>}
            </span>
            <div>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={avatarUploading}>
                {avatarUploading ? "Uploading…" : "Change photo"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleAvatarPick}
              />
              {avatarError && <p className="profile-modal-error">{avatarError}</p>}
            </div>
          </div>

          {/* Basic info */}
          <form onSubmit={handleSaveInfo} className="profile-modal-section">
            <div>
              <label>Name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <label>Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                pattern="[a-z0-9_]{3,64}"
                title="Lowercase letters, numbers, and underscores only - no spaces"
              />
              {username.length > 0 && !USERNAME_PATTERN.test(username) && (
                <p className="profile-modal-hint">Lowercase letters, numbers, and underscores only - no spaces</p>
              )}
            </div>
            <div>
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label>Timezone</label>
              <select value={tz} onChange={(e) => setTz(e.target.value)}>
                {TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            {infoMessage && (
              <p className={infoMessage.type === "error" ? "profile-modal-error" : "profile-modal-success"}>
                {infoMessage.text}
              </p>
            )}
            <button type="submit" className="primary" disabled={infoSaving}>
              {infoSaving ? "Saving…" : "Save changes"}
            </button>
          </form>

          {/* Password */}
          {hasPassword && (
            <form onSubmit={handleChangePassword} className="profile-modal-section">
              <p className="profile-modal-section-title">Password</p>
              <div>
                <label>Current password</label>
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </div>
              <div>
                <label>New password</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <div>
                <label>Confirm new password</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
              {passwordMessage && (
                <p className={passwordMessage.type === "error" ? "profile-modal-error" : "profile-modal-success"}>
                  {passwordMessage.text}
                </p>
              )}
              <button type="submit" disabled={passwordSaving || !currentPassword || !newPassword}>
                {passwordSaving ? "Updating…" : "Update password"}
              </button>
            </form>
          )}

          {/* Danger zone */}
          <div className="profile-modal-section profile-modal-danger">
            <p className="profile-modal-section-title">Danger zone</p>
            {!deleteOpen ? (
              <button type="button" className="danger" onClick={() => setDeleteOpen(true)}>
                Delete account
              </button>
            ) : (
              <div className="profile-modal-delete-confirm">
                <p>This permanently deletes your account, drafts, and connected platforms. This can't be undone.</p>
                {hasPassword ? (
                  <div>
                    <label>Enter your password to confirm</label>
                    <input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
                  </div>
                ) : (
                  <div>
                    <label>Type DELETE to confirm</label>
                    <input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} />
                  </div>
                )}
                {deleteError && <p className="profile-modal-error">{deleteError}</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => { setDeleteOpen(false); setDeletePassword(""); setDeleteConfirmText(""); setDeleteError(""); }}>
                    Cancel
                  </button>
                  <button type="button" className="danger" disabled={!deleteReady || deleting} onClick={handleDeleteAccount}>
                    {deleting ? "Deleting…" : "Permanently delete"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  ); 
}