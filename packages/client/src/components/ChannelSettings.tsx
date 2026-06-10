import { useState, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";
import { Input, Button, Modal } from "antd";
import { useChannelStore } from "../stores/useChannelStore";
import { useGuildStore } from "../stores/useGuildStore";
import * as api from "../lib/api";

type SectionKey = "overview" | "permissions" | "invites" | "integrations" | "delete";

const TOPIC_MAX_LENGTH = 1024;

interface NavItem {
  key: SectionKey;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "Overview" },
  { key: "permissions", label: "Permissions", disabled: true },
  { key: "invites", label: "Invites", disabled: true },
  { key: "integrations", label: "Integrations", disabled: true },
  { key: "delete", label: "Delete Channel", danger: true },
];

export function ChannelSettings({
  channelId,
  open,
  onClose,
}: {
  channelId: string;
  open: boolean;
  onClose: () => void;
}) {
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const { getChannels, updateChannel: updateChannelStore, removeChannel, setActiveChannel } = useChannelStore();
  const channels = getChannels(activeGuildId);
  const channel = channels.find((c) => c.id === channelId);

  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Sync form state when channel changes
  useEffect(() => {
    if (channel) {
      setName(channel.name);
      setTopic(channel.topic ?? "");
    }
  }, [channel?.id, channel?.name, channel?.topic]);

  // Reset section on open
  useEffect(() => {
    if (open) setActiveSection("overview");
  }, [open]);

  // ESC to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (deleteConfirmOpen) return;
        onClose();
      }
    },
    [onClose, deleteConfirmOpen],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open || !channel) return null;

  const hasChanges = name !== channel.name || topic !== (channel.topic ?? "");
  const nameValid = name.trim().length > 0 && name.length <= 100;

  async function handleSave() {
    if (!hasChanges || !nameValid) return;
    setSaving(true);
    try {
      const updated = await api.updateChannel(channelId, {
        name: name.trim(),
        topic: topic || undefined,
      });
      updateChannelStore(updated);
    } catch (err) {
      console.error("update channel:", err);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (!channel) return;
    setName(channel.name);
    setTopic(channel.topic ?? "");
  }

  async function handleDelete() {
    try {
      await api.deleteChannel(channelId);
      removeChannel(channelId);
      setActiveChannel(null);
      onClose();
    } catch (err) {
      console.error("delete channel:", err);
    }
  }

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button onClick={onClose} className="settings-close-btn" aria-label="Close channel settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Sidebar */}
        <div className="settings-sidebar">
          <div style={channelHeaderStyle}>
            <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-lg)" }}>#</span>
            <span style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--text-normal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {channel.name}
            </span>
          </div>
          <div className="settings-divider" style={dividerStyle} />
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => !item.disabled && setActiveSection(item.key)}
              className={`settings-nav-item${activeSection === item.key ? " active" : ""}`}
              style={{
                color: item.danger
                  ? "var(--danger)"
                  : item.disabled
                    ? "var(--text-faint, var(--text-muted))"
                    : activeSection === item.key
                      ? "var(--text-normal)"
                      : "var(--text-muted)",
                cursor: item.disabled ? "not-allowed" : "pointer",
                opacity: item.disabled ? 0.5 : 1,
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="settings-content">
          <div style={contentInnerStyle}>
            {activeSection === "overview" && (
              <div>
                <h2 style={sectionTitleStyle}>Overview</h2>

                <div style={{ marginBottom: "var(--space-xl)" }}>
                  <label style={fieldLabelStyle}>CHANNEL NAME</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                    style={inputStyle}
                  />
                </div>

                <div style={{ marginBottom: "var(--space-xl)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label style={fieldLabelStyle}>CHANNEL TOPIC</label>
                    <span style={charCountStyle}>{TOPIC_MAX_LENGTH - topic.length}</span>
                  </div>
                  <Input.TextArea
                    value={topic}
                    onChange={(e) => setTopic(e.target.value.slice(0, TOPIC_MAX_LENGTH))}
                    maxLength={TOPIC_MAX_LENGTH}
                    rows={4}
                    placeholder="Let everyone know what this channel is about"
                    style={inputStyle}
                  />
                </div>

                {hasChanges && (
                  <div style={saveBarStyle}>
                    <span style={{ color: "var(--text-normal)", fontSize: "var(--font-size-md)" }}>
                      Careful — you have unsaved changes!
                    </span>
                    <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                      <Button onClick={handleReset} disabled={saving}>
                        Reset
                      </Button>
                      <Button
                        type="primary"
                        onClick={handleSave}
                        loading={saving}
                        disabled={!nameValid}
                      >
                        Save Changes
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeSection === "permissions" && (
              <div>
                <h2 style={sectionTitleStyle}>Permissions</h2>
                <p style={{ color: "var(--text-muted)" }}>Channel permissions are coming soon.</p>
              </div>
            )}

            {activeSection === "invites" && (
              <div>
                <h2 style={sectionTitleStyle}>Invites</h2>
                <p style={{ color: "var(--text-muted)" }}>Invite management is coming soon.</p>
              </div>
            )}

            {activeSection === "integrations" && (
              <div>
                <h2 style={sectionTitleStyle}>Integrations</h2>
                <p style={{ color: "var(--text-muted)" }}>Integration settings are coming soon.</p>
              </div>
            )}

            {activeSection === "delete" && (
              <div>
                <h2 style={sectionTitleStyle}>Delete Channel</h2>
                <p style={{ color: "var(--text-muted)", marginBottom: "var(--space-lg)" }}>
                  Deleting a channel is permanent. All messages will be lost and cannot be recovered.
                </p>
                <Button danger type="primary" onClick={() => setDeleteConfirmOpen(true)}>
                  Delete Channel
                </Button>
                <Modal
                  title={`Delete #${channel.name}?`}
                  open={deleteConfirmOpen}
                  onCancel={() => setDeleteConfirmOpen(false)}
                  onOk={handleDelete}
                  okText="Delete Channel"
                  okButtonProps={{ danger: true }}
                  cancelText="Cancel"
                >
                  <p>
                    Are you sure you want to delete <strong>#{channel.name}</strong>? This action
                    cannot be undone and all messages in this channel will be permanently removed.
                  </p>
                </Modal>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const channelHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  padding: "var(--space-md) var(--space-sm)",
};

const dividerStyle: CSSProperties = {
  height: 1,
  background: "var(--bg-modifier-hover)",
  margin: "var(--space-sm) var(--space-sm)",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "var(--font-size-xl)",
  fontWeight: 600,
  color: "var(--text-normal)",
  marginBottom: "var(--space-xl)",
  marginTop: 0,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  color: "var(--text-muted)",
  marginBottom: "var(--space-sm)",
  display: "block",
};

const charCountStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--text-muted)",
};

const inputStyle: CSSProperties = {
  background: "var(--input-background, var(--bg-tertiary))",
  borderColor: "var(--border-subtle)",
  color: "var(--text-normal)",
};

const contentInnerStyle: CSSProperties = {
  maxWidth: "var(--settings-content-max-width)",
  width: "100%",
};

const saveBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "var(--space-md) var(--space-lg)",
  background: "var(--bg-tertiary, var(--bg-secondary))",
  borderRadius: "var(--space-xs)",
  position: "sticky",
  bottom: 0,
};
