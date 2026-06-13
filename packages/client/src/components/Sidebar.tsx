import { useChannelStore } from "../stores/useChannelStore";
import { useGuildStore } from "../stores/useGuildStore";
import { useReadStateStore } from "../stores/useReadStateStore";
import { Button, Input, Spin } from "antd";
import { PlusOutlined, SettingOutlined } from "@ant-design/icons";
import * as api from "../lib/api";
import { useState } from "react";
import type { CSSProperties } from "react";
import { ChannelSettings } from "./ChannelSettings";

const styles = {
  root: { display: "flex", flexDirection: "column", background: "var(--bg-secondary)", borderRight: "none", minHeight: 0, overflow: "hidden" } as CSSProperties,
  header: { display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "var(--space-md) var(--space-lg)", borderBottom: "1px solid var(--border-subtle)", height: "var(--header-height)", flexShrink: 0 } as CSSProperties,
  title: { fontSize: "var(--font-size-lg)", fontWeight: 700, margin: 0, color: "var(--header-primary)" } as CSSProperties,
  list: { flex: 1, overflowY: "auto", padding: "0 var(--space-sm)" } as CSSProperties,
  loading: { display: "flex", justifyContent: "center", padding: "var(--space-xxl)" } as CSSProperties,
  categoryHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-lg) var(--space-sm) var(--space-xs)", fontSize: "var(--font-size-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", cursor: "default" } as CSSProperties,
  channelItem: { display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "var(--space-xs) var(--space-sm)", borderRadius: "var(--space-xs)", cursor: "pointer", transition: "background 0.15s", fontSize: "var(--font-size-md)", color: "var(--interactive-normal)" } as CSSProperties,
  channelActive: { background: "var(--bg-modifier-active)", color: "var(--interactive-active)" } as CSSProperties,
  channelHover: { background: "var(--bg-modifier-hover)", color: "var(--interactive-hover)" } as CSSProperties,
  hash: { fontSize: "var(--font-size-lg)", fontWeight: 600, opacity: 0.5, width: "var(--space-xl)", textAlign: "center", flexShrink: 0 } as CSSProperties,
  channelName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 } as CSSProperties,
  settingsBtn: { opacity: 0, fontSize: "var(--font-size-sm)", transition: "opacity 0.15s" } as CSSProperties,
  addBtn: { margin: "var(--space-xs) var(--space-sm) var(--space-sm)", opacity: 0.5, fontSize: "var(--font-size-sm)" } as CSSProperties,
};

function ChannelItem({ name, isActive, isUnread, isMentioned, mentionCount, onSelect, onSettings }: {
  name: string; isActive: boolean; isUnread: boolean; isMentioned: boolean; mentionCount: number; onSelect: () => void; onSettings: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{ ...styles.channelItem, ...(isActive ? styles.channelActive : hovered ? styles.channelHover : {}) }}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={styles.hash}>#</span>
      <span style={{ ...styles.channelName, ...(isUnread && !isActive ? { color: "var(--interactive-active)", fontWeight: 600 } : {}) }}>{name}</span>
      {isMentioned && !isActive && (
        <span style={{ marginLeft: "auto", background: "var(--status-danger, #ed4245)", color: "#fff", borderRadius: 8, minWidth: 16, height: 16, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: "0 4px" }}>{mentionCount}</span>
      )}
      <Button
        type="text"
        size="small"
        icon={<SettingOutlined />}
        onClick={(e) => { e.stopPropagation(); onSettings(); }}
        style={{ ...styles.settingsBtn, opacity: hovered ? 0.5 : 0 }}
      />
    </div>
  );
}

export function Sidebar({ onClose, loading, style }: { onClose?: () => void; loading?: boolean; style?: CSSProperties }) {
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const { activeChannelId, setActiveChannel, addChannel, getChannels } = useChannelStore();
  const channels = getChannels(activeGuildId);
  const { unreadChannels, mentionCounts } = useReadStateStore();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [settingsChannelId, setSettingsChannelId] = useState<string | null>(null);

  function handleSelectChannel(id: string) {
    setActiveChannel(id);
    onClose?.();
  }

  async function handleAddChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      if (!activeGuildId) return;
      const ch = await api.createChannel(activeGuildId, newName.trim());
      addChannel(ch);
      setNewName("");
      setAdding(false);
    } catch (err) { console.error("create channel:", err); }
  }

  return (
    <div style={{ ...styles.root, ...style }} className="sidebar-panel">
      <div style={styles.header}>
        <span style={{ fontSize: "var(--font-size-xl)" }}>🏝️</span>
        <h1 style={styles.title}>Cove</h1>
      </div>

      <div style={styles.list} className="scroll-container">
        {loading ? (
          <div style={styles.loading}><Spin tip="Loading channels…" /></div>
        ) : (
          <>
            <div style={styles.categoryHeader}>
              <span>Channels</span>
              <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => setAdding(true)} style={{ color: "var(--interactive-normal)", fontSize: "var(--font-size-sm)", opacity: 0.6 }} />
            </div>
            {channels.map((ch) => (
              <ChannelItem
                key={ch.id}
                name={ch.name}
                isActive={ch.id === activeChannelId}
                isUnread={!!unreadChannels[ch.id]}
                isMentioned={!!mentionCounts[ch.id]}
                mentionCount={mentionCounts[ch.id] || 0}
                onSelect={() => handleSelectChannel(ch.id)}
                onSettings={() => setSettingsChannelId(ch.id)}
              />
            ))}
            {adding && (
              <form onSubmit={handleAddChannel} style={{ padding: "var(--space-xs) var(--space-sm)" }}>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="channel-name" autoFocus size="small" style={{ marginBottom: "var(--space-xs)" }} />
                <div style={{ display: "flex", gap: "var(--space-xs)" }}>
                  <Button type="primary" htmlType="submit" size="small" style={{ flex: 1 }}>Create</Button>
                  <Button size="small" onClick={() => setAdding(false)}>Cancel</Button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
      {settingsChannelId && (
        <ChannelSettings
          channelId={settingsChannelId}
          open={!!settingsChannelId}
          onClose={() => setSettingsChannelId(null)}
        />
      )}
    </div>
  );
}
