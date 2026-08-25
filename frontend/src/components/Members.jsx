// Members.jsx — workspace members & their per-platform publish access.
// Every member's access to a given platform is their default_access
// unless a MemberPlatformAccess override exists for that one platform
// (see main.py's Workspace/Members section). Mutating endpoints are
// admin-only server-side; non-admins land here read-only.
import { useEffect, useState } from "react";
import {
  getWorkspace, getWorkspaceMembers, addWorkspaceMember, updateWorkspaceMember,
  removeWorkspaceMember, setMemberPlatformAccess, clearMemberPlatformAccess,
  getPendingApprovals, decideApprovalRequest,
} from "../api";
import { PLATFORMS, PlatformLogo } from "./platforms";

const ACCESS_LABELS = { full: "Full access", needs_approval: "Needs approval" };

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

// One outstanding approval request: what was asked for (immediate publish
// vs a future schedule, and which platforms) plus grant/deny actions.
function PendingApprovalRow({ request, onDecide }) {
  const [deciding, setDeciding] = useState(false);
  const [denying, setDenying] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function handleGrant() {
    setDeciding(true);
    try {
      await onDecide(request.draft_id, "grant");
    } finally {
      setDeciding(false);
    }
  }

  async function handleDeny() {
    setDeciding(true);
    try {
      await onDecide(request.draft_id, "deny", feedback.trim() || undefined);
      setDenying(false);
      setFeedback("");
    } finally {
      setDeciding(false);
    }
  }

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 8, padding: 14,
        background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)", borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500 }}>
            {request.title || `${request.category}: ${request.subtopic}`}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
            {request.requested_scheduled_at
              ? `Wants to schedule for ${new Date(request.requested_scheduled_at).toLocaleString()}`
              : "Wants to publish now"}
            {" \u2014 "}
            {(request.requested_platforms || []).join(", ")}
          </div>
        </div>
        {!denying && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button type="button" className="primary" disabled={deciding} onClick={handleGrant} style={{ fontSize: 12, padding: "4px 10px" }}>
              Approve
            </button>
            <button type="button" disabled={deciding} onClick={() => setDenying(true)} style={{ fontSize: 12, padding: "4px 10px" }}>
              Decline
            </button>
          </div>
        )}
      </div>
      {denying && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Optional note for them"
            style={{ fontSize: 12.5, flex: 1 }}
          />
          <button type="button" className="danger" disabled={deciding} onClick={handleDeny} style={{ fontSize: 12, padding: "4px 10px" }}>
            {deciding ? "Declining\u2026" : "Confirm decline"}
          </button>
          <button type="button" disabled={deciding} onClick={() => setDenying(false)} style={{ fontSize: 12, padding: "4px 10px" }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function RoleBadge({ role }) {
  const admin = role === "admin";
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 500, borderRadius: 4, padding: "2px 7px",
        color: admin ? "var(--accent)" : "var(--text-secondary)",
        background: admin ? "rgba(76,175,125,0.12)" : "var(--border)",
        textTransform: "uppercase", letterSpacing: 0.3,
      }}
    >
      {admin ? "Admin" : "Member"}
    </span>
  );
}

// One platform cell: shows the effective access (override, else default)
// and, for admins looking at another member, a small select to change it.
function PlatformAccessCell({ member, platform, canEdit, onChange, busy }) {
  const override = member.platform_overrides?.[platform.key];
  const effective = override || member.default_access;

  if (!canEdit) {
    return (
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        {ACCESS_LABELS[effective]}
        {override && <span title="Overrides the default"> *</span>}
      </span>
    );
  }

  return (
    <select
      value={effective}
      disabled={busy}
      onChange={(e) => onChange(platform.key, e.target.value)}
      style={{ fontSize: 12, padding: "3px 6px" }}
    >
      <option value="full">Full access</option>
      <option value="needs_approval">Needs approval</option>
      {override && <option value="__clear">Use default ({ACCESS_LABELS[member.default_access]})</option>}
    </select>
  );
}

function MemberRow({ member, isSelf, canManage, onUpdateDefault, onRemove, onSetPlatformAccess }) {
  const [busyPlatform, setBusyPlatform] = useState(null);
  const [busyDefault, setBusyDefault] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const isOwner = member.role === "admin";
  const editable = canManage && !isOwner;

  async function handlePlatformChange(platformKey, value) {
    setBusyPlatform(platformKey);
    try {
      if (value === "__clear") {
        await onSetPlatformAccess(member.id, platformKey, null);
      } else {
        await onSetPlatformAccess(member.id, platformKey, value);
      }
    } finally {
      setBusyPlatform(null);
    }
  }

  async function handleDefaultChange(e) {
    setBusyDefault(true);
    try {
      await onUpdateDefault(member.id, e.target.value);
    } finally {
      setBusyDefault(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await onRemove(member.id);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <tr style={{ borderTop: "0.5px solid var(--border-strong)" }}>
      <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 28, height: 28, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
              background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 600, color: "var(--text-secondary)",
            }}
          >
            {member.avatar_url
              ? <img src={member.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : initials(member.full_name || member.username)}
          </span>
          <div>
            <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>
              {member.full_name || member.username}
              {isSelf && <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}> (you)</span>}
            </div>
            {member.username && <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>@{member.username}</div>}
          </div>
        </div>
      </td>
      <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>
        <RoleBadge role={member.role} />
      </td>
      <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>
        {editable ? (
          <select value={member.default_access} disabled={busyDefault} onChange={handleDefaultChange} style={{ fontSize: 12, padding: "3px 6px" }}>
            <option value="full">Full access</option>
            <option value="needs_approval">Needs approval</option>
          </select>
        ) : (
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {isOwner ? "Owner \u2014 full access" : ACCESS_LABELS[member.default_access]}
          </span>
        )}
      </td>
      {PLATFORMS.map((platform) => (
        <td key={platform.key} style={{ padding: "10px 12px", verticalAlign: "middle" }}>
          {isOwner ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <PlatformLogo platform={platform} size={13} />
              <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Full</span>
            </span>
          ) : (
            <PlatformAccessCell
              member={member}
              platform={platform}
              canEdit={editable}
              busy={busyPlatform === platform.key}
              onChange={handlePlatformChange}
            />
          )}
        </td>
      ))}
      <td style={{ padding: "10px 12px", verticalAlign: "middle", textAlign: "right" }}>
        {canManage && !isOwner && (
          confirmRemove ? (
            <span style={{ display: "inline-flex", gap: 6 }}>
              <button type="button" className="danger" disabled={removing} onClick={handleRemove} style={{ fontSize: 12, padding: "4px 8px" }}>
                {removing ? "Removing…" : "Confirm"}
              </button>
              <button type="button" disabled={removing} onClick={() => setConfirmRemove(false)} style={{ fontSize: 12, padding: "4px 8px" }}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmRemove(true)} style={{ fontSize: 12, padding: "4px 8px" }}>
              Remove
            </button>
          )
        )}
      </td>
    </tr>
  );
}

export default function Members({ token, onAuthError, profile }) {
  const selfUsername = profile?.username || null;
  const [workspace, setWorkspace] = useState(null); // { id, name, plan, role }
  const [members, setMembers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [pendingApprovals, setPendingApprovals] = useState(null);
  const [approvalsError, setApprovalsError] = useState(null);

  const [addUsername, setAddUsername] = useState("");
  const [addAccess, setAddAccess] = useState("needs_approval");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  function load() {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getWorkspace({ token }), getWorkspaceMembers({ token })])
      .then(([ws, mem]) => {
        if (cancelled) return;
        setWorkspace(ws);
        setMembers(mem);
        if (ws.role === "admin") {
          getPendingApprovals({ token })
            .then((reqs) => { if (!cancelled) setPendingApprovals(reqs); })
            .catch((e) => {
              if (cancelled) return;
              if (e.status === 401) return onAuthError?.();
              setApprovalsError(e.message || "Failed to load pending approvals");
              setPendingApprovals([]);
            });
        }
      })
      .catch((e) => {
        if (cancelled) return;
        if (e.status === 401) return onAuthError?.();
        setError(e.message || "Failed to load members");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }

  useEffect(load, [token]);

  const isAdmin = workspace?.role === "admin";

  async function handleDecideApproval(draftId, decision, feedback) {
    try {
      await decideApprovalRequest({ token, draftId, decision, feedback });
      setPendingApprovals((prev) => (prev || []).filter((r) => r.draft_id !== draftId));
    } catch (e) {
      if (e.status === 401) return onAuthError?.();
      setApprovalsError(e.message || "Couldn't record that decision");
    }
  }

  async function handleAddMember(e) {
    e.preventDefault();
    const username = addUsername.trim().toLowerCase();
    if (!username) return;
    setAdding(true);
    setAddError("");
    try {
      const member = await addWorkspaceMember({ token, username, defaultAccess: addAccess });
      setMembers((prev) => [...(prev || []), member]);
      setAddUsername("");
      setAddAccess("needs_approval");
    } catch (e) {
      if (e.status === 401) return onAuthError?.();
      setAddError(e.message || "Couldn't add that member");
    } finally {
      setAdding(false);
    }
  }

  async function handleUpdateDefault(memberId, defaultAccess) {
    try {
      const updated = await updateWorkspaceMember({ token, memberId, defaultAccess });
      setMembers((prev) => prev.map((m) => (m.id === memberId ? updated : m)));
    } catch (e) {
      if (e.status === 401) return onAuthError?.();
      setError(e.message || "Couldn't update access");
    }
  }

  async function handleRemove(memberId) {
    try {
      await removeWorkspaceMember({ token, memberId });
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (e) {
      if (e.status === 401) return onAuthError?.();
      setError(e.message || "Couldn't remove member");
    }
  }

  async function handleSetPlatformAccess(memberId, platform, access) {
    try {
      const updated = access === null
        ? await clearMemberPlatformAccess({ token, memberId, platform })
        : await setMemberPlatformAccess({ token, memberId, platform, access });
      setMembers((prev) => prev.map((m) => (m.id === memberId ? updated : m)));
    } catch (e) {
      if (e.status === 401) return onAuthError?.();
      setError(e.message || "Couldn't update platform access");
    }
  }

  if (loading) {
    return <div style={{ padding: "3rem 0", textAlign: "center", color: "var(--text-secondary)" }}>Loading members…</div>;
  }
  if (error) {
    return <div style={{ padding: "2rem", color: "var(--danger)" }}>{error}</div>;
  }

  return (
    <div>
      <p style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--ink)", margin: "0 0 4px" }}>
        Members
      </p>
      <p style={{ fontSize: 13.5, color: "var(--text-secondary)", margin: "0 0 20px" }}>
        {isAdmin
          ? "Invite people to your workspace and control what they can schedule or publish on each platform."
          : "People with access to this workspace. Only the workspace admin can change access."}
      </p>

      {isAdmin && (pendingApprovals === null || pendingApprovals.length > 0) && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink)", margin: "0 0 8px" }}>
            Waiting on your approval
          </p>
          {approvalsError && <p style={{ fontSize: 12.5, color: "var(--danger)", margin: "0 0 8px" }}>{approvalsError}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(pendingApprovals || []).map((request) => (
              <PendingApprovalRow key={request.draft_id} request={request} onDecide={handleDecideApproval} />
            ))}
            {pendingApprovals === null && (
              <p style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Loading…</p>
            )}
          </div>
        </div>
      )}

      {isAdmin && (
        <form
          onSubmit={handleAddMember}
          style={{
            display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap",
            background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
            borderRadius: 8, padding: 14, marginBottom: 20,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Username</label>
            <input
              type="text"
              value={addUsername}
              onChange={(e) => setAddUsername(e.target.value)}
              placeholder="their-username"
              style={{ fontSize: 13, minWidth: 200 }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Default access</label>
            <select value={addAccess} onChange={(e) => setAddAccess(e.target.value)} style={{ fontSize: 13, padding: "6px 8px" }}>
              <option value="needs_approval">Needs approval</option>
              <option value="full">Full access</option>
            </select>
          </div>
          <button type="submit" className="primary" disabled={adding || !addUsername.trim()} style={{ fontSize: 13 }}>
            {adding ? "Adding…" : "Add member"}
          </button>
          {addError && <div style={{ fontSize: 12.5, color: "var(--danger)", flexBasis: "100%" }}>{addError}</div>}
        </form>
      )}

      <div style={{ overflowX: "auto", border: "0.5px solid var(--border-strong)", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr style={{ borderBottom: "0.5px solid var(--border-strong)" }}>
              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", fontWeight: 500 }}>Member</th>
              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", fontWeight: 500 }}>Role</th>
              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", fontWeight: 500 }}>Default access</th>
              {PLATFORMS.map((platform) => (
                <th key={platform.key} style={{ textAlign: "left", padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", fontWeight: 500 }}>
                  {platform.label}
                </th>
              ))}
              <th style={{ padding: "10px 12px" }} />
            </tr>
          </thead>
          <tbody>
            {(members || []).map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                isSelf={member.username === selfUsername}
                canManage={isAdmin}
                onUpdateDefault={handleUpdateDefault}
                onRemove={handleRemove}
                onSetPlatformAccess={handleSetPlatformAccess}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}