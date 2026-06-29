import { useState, useEffect, useCallback } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRoleStore } from "../stores/useRoleStore";
import { useGuildStore } from "../stores/useGuildStore";
import { useUserPermissions } from "../lib/useUserPermissions";
import * as api from "../lib/api";
import { RoleList } from "./RoleList";
import { RoleEditor } from "./RoleEditor";
import { MembersRoleSection } from "./MembersRoleSection";
import { Modal, Input, Button, message } from "antd";

/* ── Nav sections ───────────────────────────────────────────── */

type SectionKey = "overview" | "roles" | "members" | "danger";

interface NavItem {
  key: SectionKey;
  label: string;
  header: string;
  ownerOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "Overview", header: "SERVER SETTINGS" },
  { key: "roles", label: "Roles", header: "SERVER SETTINGS" },
  { key: "members", label: "Members", header: "USER MANAGEMENT" },
  { key: "danger", label: "Delete Server", header: "DANGER ZONE", ownerOnly: true },
];

/* ── Section content components ─────────────────────────────── */

function RolesSection({ guildId }: { guildId: string }) {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const { userHighestPosition, userPermissions } = useUserPermissions(guildId);

  // Fetch roles on mount
  useEffect(() => {
    api.fetchRoles(guildId).then((r) => useRoleStore.getState().setRoles(guildId, r)).catch(() => alert("Failed to load roles"));
  }, [guildId]);

  return (
    <div>
      <h2 style={sectionTitleStyle}>Roles</h2>
      <div style={rolesSectionStyle}>
        <RoleList
          guildId={guildId}
          selectedRoleId={selectedRoleId}
          onSelectRole={setSelectedRoleId}
          userHighestPosition={userHighestPosition}
        />
        {selectedRoleId ? (
          <RoleEditor
            guildId={guildId}
            roleId={selectedRoleId}
            userHighestPosition={userHighestPosition}
            userPermissions={userPermissions}
          />
        ) : (
          <div style={{ color: "var(--text-muted)", padding: "var(--space-lg)", flex: 1 }}>
            Select a role to edit its settings.
          </div>
        )}
      </div>
    </div>
  );
}

function MembersSection({ guildId }: { guildId: string }) {
  const { userHighestPosition } = useUserPermissions(guildId);
  return <MembersRoleSection guildId={guildId} userHighestPosition={userHighestPosition} />;
}

function OverviewSection({ guildId }: { guildId: string }) {
  const guild = useGuildStore((s) => s.guilds[guildId]);
  const [name, setName] = useState(guild?.name ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(guild?.name ?? "");
  }, [guild?.name]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      message.error("Server name must be 2–100 characters");
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateGuild(guildId, { name: trimmed });
      useGuildStore.getState().updateGuild(guildId, updated);
      message.success("Server updated");
    } catch {
      message.error("Failed to update server");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 style={sectionTitleStyle}>Server Overview</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 400 }}>
        <div>
          <label style={{ display: "block", marginBottom: 4, fontWeight: 500, color: "var(--text-muted)", fontSize: "var(--font-size-sm)", textTransform: "uppercase" }}>
            Server Name
          </label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </div>
        <Button
          type="primary"
          onClick={handleSave}
          loading={saving}
          disabled={name.trim() === guild?.name || name.trim().length < 2}
          style={{ alignSelf: "flex-start" }}
        >
          Save Changes
        </Button>
      </div>
    </div>
  );
}

function DangerSection({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const guild = useGuildStore((s) => s.guilds[guildId]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const isSeed = guild?.owner_id === null;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteGuild(guildId);
      message.success("Server deleted");
      // Close settings panel — the GUILD_DELETE gateway event
      // handles store cleanup and navigation redirect.
      onClose();
    } catch {
      message.error("Failed to delete server");
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div>
      <h2 style={sectionTitleStyle}>Delete Server</h2>
      {isSeed ? (
        <p style={{ color: "var(--text-muted)" }}>The seed server cannot be deleted.</p>
      ) : (
        <>
          <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>
            Deleting a server is permanent. All channels, messages, and data will be lost.
          </p>
          <Button danger onClick={() => setConfirmOpen(true)}>
            Delete Server
          </Button>
          <Modal
            title="Delete Server"
            open={confirmOpen}
            onCancel={() => { setConfirmOpen(false); setConfirmText(""); }}
            footer={null}
            destroyOnClose
          >
            <p style={{ marginBottom: 12 }}>
              Type <strong>{guild?.name}</strong> to confirm deletion:
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={guild?.name}
              autoFocus
            />
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button onClick={() => { setConfirmOpen(false); setConfirmText(""); }}>Cancel</Button>
              <Button
                danger
                type="primary"
                onClick={handleDelete}
                loading={deleting}
                disabled={confirmText !== guild?.name}
              >
                Delete
              </Button>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}

const sectionTitleStyle: CSSProperties = {
  fontSize: "var(--font-size-xl)",
  fontWeight: 600,
  color: "var(--text-normal)",
  marginBottom: "var(--space-xl)",
  marginTop: 0,
};

const SECTION_COMPONENTS: Record<SectionKey, (guildId: string, onClose: () => void) => ReactNode> = {
  overview: (guildId) => <OverviewSection guildId={guildId} />,
  roles: (guildId) => <RolesSection guildId={guildId} />,
  members: (guildId) => <MembersSection guildId={guildId} />,
  danger: (guildId, onClose) => <DangerSection guildId={guildId} onClose={onClose} />,
};

/* ── Main Server Settings Panel ─────────────────────────────── */

export function ServerSettings({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const { isOwner } = useUserPermissions(guildId);

  const visibleItems = NAV_ITEMS.filter((item) => !item.ownerOnly || isOwner);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [close]);

  return (
    <div className="settings-backdrop" onClick={close}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button onClick={close} className="settings-close-btn" aria-label="Close server settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Sidebar */}
        <div className="settings-sidebar">
          {visibleItems.map((item, idx) => {
            const prevHeader = idx > 0 ? visibleItems[idx - 1].header : null;
            const showHeader = item.header !== prevHeader;
            return (
              <div key={item.key}>
                {showHeader && (
                  <>
                    {idx > 0 && <div className="settings-divider" style={dividerStyle} />}
                    <div className="settings-category-header" style={categoryHeaderStyle}>
                      {item.header}
                    </div>
                  </>
                )}
                <button
                  onClick={() => setActiveSection(item.key)}
                  className={`settings-nav-item${activeSection === item.key ? " active" : ""}`}
                  style={{
                    color: activeSection === item.key ? "var(--text-normal)" : item.key === "danger" ? "var(--status-danger, #ed4245)" : "var(--text-muted)",
                  }}
                >
                  {item.label}
                </button>
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div className="settings-content">
          <div style={contentInnerStyle}>
            {SECTION_COMPONENTS[activeSection](guildId, close)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const categoryHeaderStyle: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  color: "var(--text-muted)",
  padding: "var(--space-xs) var(--space-sm)",
  marginBottom: "var(--space-xxs)",
};

const dividerStyle: CSSProperties = {
  height: 1,
  background: "var(--bg-modifier-hover)",
  margin: "var(--space-sm) var(--space-sm)",
};

const contentInnerStyle: CSSProperties = {
  maxWidth: "var(--settings-content-max-width)",
  width: "100%",
};

const rolesSectionStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-xl)",
};
