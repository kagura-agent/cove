import { useChannelStore } from "../stores/useChannelStore";
import { useReadStateStore } from "../stores/useReadStateStore";
import { Button, Input, Popconfirm, Spin } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import * as api from "../lib/api";
import { useState } from "react";
import type { CSSProperties } from "react";

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
  deleteBtn: { opacity: 0, fontSize: "var(--font-size-sm)", transition: "opacity 0.15s" } as CSSProperties,
  addBtn: { margin: "var(--space-xs) var(--space-sm) var(--space-sm)", opacity: 0.5, fontSize: "var(--font-size-sm)" } as CSSProperties,
};

function ChannelItem({ name, isActive, isUnread, onSelect, onDelete }: {
  name: string; isActive: boolean; isUnread: boolean; onSelect: () => void; onDelete: () => void;
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
      <Popconfirm title={`Delete #${name}?`} description="All messages will be lost." onConfirm={(e) => { e?.stopPropagation(); onDelete(); }} onCancel={(e) => e?.stopPropagation()} okText="Delete" cancelText="Cancel" okButtonProps={{ danger: true }}>
        <Button
          type="text"
          size="small"
          icon={<DeleteOutlined />}
          onClick={(e) => e.stopPropagation()}
          style={{ ...styles.deleteBtn, opacity: hovered ? 0.5 : 0 }}
        />
      </Popconfirm>
    </div>
  );
}

export function Sidebar({ onClose, loading, style }: { onClose?: () => void; loading?: boolean; style?: CSSProperties }) {
  const { channels, activeChannelId, setActiveChannel, removeChannel, addChannel } = useChannelStore();
  const { unreadChannels } = useReadStateStore();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  function handleSelectChannel(id: string) {
    setActiveChannel(id);
    onClose?.();
  }

  async function handleDeleteChannel(id: string) {
    try {
      await api.deleteChannel(id);
      removeChannel(id);
    } catch (err) { console.error("delete channel:", err); }
  }

  async function handleAddChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const ch = await api.createChannel(newName.trim());
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
                onSelect={() => handleSelectChannel(ch.id)}
                onDelete={() => handleDeleteChannel(ch.id)}
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
    </div>
  );
}
