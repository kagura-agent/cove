import { useChannelStore } from "../stores/useChannelStore";
import { Button, Input, Popconfirm, Spin } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { UserBar } from "./UserBar";
import * as api from "../lib/api";
import { useState } from "react";
import type { CSSProperties } from "react";

const styles = {
  root: { display: "flex", flexDirection: "column", height: "100%", width: 240, minWidth: 240, background: "var(--bg-secondary)", borderRight: "none" } as CSSProperties,
  header: { padding: "16px 16px 12px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 } as CSSProperties,
  title: { fontSize: 16, fontWeight: 700, margin: 0, color: "var(--header-primary)" } as CSSProperties,
  list: { flex: 1, overflowY: "auto", padding: "0 8px" } as CSSProperties,
  loading: { display: "flex", justifyContent: "center", padding: 24 } as CSSProperties,
  categoryHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 8px 4px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", cursor: "default" } as CSSProperties,
  channelItem: { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 4, cursor: "pointer", transition: "background 0.15s", fontSize: 14, color: "var(--interactive-normal)" } as CSSProperties,
  channelActive: { background: "var(--bg-modifier-active)", color: "var(--interactive-active)" } as CSSProperties,
  channelHover: { background: "var(--bg-modifier-hover)", color: "var(--interactive-hover)" } as CSSProperties,
  hash: { fontSize: 18, fontWeight: 600, opacity: 0.5, width: 20, textAlign: "center", flexShrink: 0 } as CSSProperties,
  channelName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 } as CSSProperties,
  deleteBtn: { opacity: 0, fontSize: 12, transition: "opacity 0.15s" } as CSSProperties,
  addBtn: { margin: "4px 8px 8px", opacity: 0.5, fontSize: 12 } as CSSProperties,
};

function ChannelItem({ id, name, isActive, onSelect, onDelete }: {
  id: string; name: string; isActive: boolean; onSelect: () => void; onDelete: () => void;
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
      <span style={styles.channelName}>{name}</span>
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

export function Sidebar({ onClose, loading, onSettingsOpen }: { onClose?: () => void; loading?: boolean; onSettingsOpen?: () => void }) {
  const { channels, activeChannelId, setActiveChannel, removeChannel, addChannel } = useChannelStore();
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
      const ch = await api.createChannel(newName.trim(), "#️⃣");
      addChannel(ch);
      setNewName("");
      setAdding(false);
    } catch (err) { console.error("create channel:", err); }
  }

  return (
    <div style={styles.root} className="sidebar-panel">
      <div style={styles.header}>
        <span style={{ fontSize: 20 }}>🏝️</span>
        <h1 style={styles.title}>Cove</h1>
      </div>

      <div style={styles.list}>
        {loading ? (
          <div style={styles.loading}><Spin tip="Loading scenes…" /></div>
        ) : (
          <>
            <div style={styles.categoryHeader}>
              <span>Scenes</span>
              <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => setAdding(true)} style={{ color: "var(--interactive-normal)", fontSize: 12, opacity: 0.6 }} />
            </div>
            {channels.map((ch) => (
              <ChannelItem
                key={ch.id}
                id={ch.id}
                name={ch.name}
                isActive={ch.id === activeChannelId}
                onSelect={() => handleSelectChannel(ch.id)}
                onDelete={() => handleDeleteChannel(ch.id)}
              />
            ))}
            {adding && (
              <form onSubmit={handleAddChannel} style={{ padding: "4px 8px" }}>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="channel-name" autoFocus size="small" style={{ marginBottom: 4 }} />
                <div style={{ display: "flex", gap: 4 }}>
                  <Button type="primary" htmlType="submit" size="small" style={{ flex: 1 }}>Create</Button>
                  <Button size="small" onClick={() => setAdding(false)}>Cancel</Button>
                </div>
              </form>
            )}
          </>
        )}
      </div>

      <UserBar onCloseSidebar={onClose} onSettingsOpen={onSettingsOpen} />
    </div>
  );
}
