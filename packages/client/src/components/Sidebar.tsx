import { useChannelStore } from "../stores/useChannelStore";
import { getChannelIcon } from "../lib/icons";
import { Button, Input, Menu, Popconfirm, Spin } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { UserBar } from "./UserBar";
import * as api from "../lib/api";
import { useState } from "react";
import type { CSSProperties } from "react";

const styles = {
  root: { display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)" } as CSSProperties,
  header: { padding: "20px 20px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" } as CSSProperties,
  title: { fontSize: 22, fontWeight: 700, margin: 0, color: "var(--text-primary)" } as CSSProperties,
  subtitle: { fontSize: 12, color: "var(--text-secondary)", marginTop: 2 } as CSSProperties,
  list: { flex: 1, overflowY: "auto", padding: 8 } as CSSProperties,
  loading: { display: "flex", justifyContent: "center", padding: 24 } as CSSProperties,
  menuItem: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" } as CSSProperties,
  channelName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as CSSProperties,
  deleteBtn: { opacity: 0.4, fontSize: 12 } as CSSProperties,
  menu: { background: "transparent", border: "none" } as CSSProperties,
  addBtn: { marginTop: 8, opacity: 0.6 } as CSSProperties,
};

export function Sidebar({ onClose, loading }: { onClose?: () => void; loading?: boolean }) {
  const { channels, activeChannelId, setActiveChannel, removeChannel, addChannel } = useChannelStore();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("🏝️");

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
      const ch = await api.createChannel(newName.trim(), newIcon || "🏝️");
      addChannel(ch);
      setNewName("");
      setNewIcon("🏝️");
      setAdding(false);
    } catch (err) { console.error("create channel:", err); }
  }

  const menuItems = channels.map((ch) => ({
    key: ch.id,
    label: (
      <div style={styles.menuItem}>
        <span style={styles.channelName}>{ch.name}</span>
        <Popconfirm title={`Delete #${ch.name}?`} description="All messages will be lost." onConfirm={(e) => { e?.stopPropagation(); handleDeleteChannel(ch.id); }} onCancel={(e) => e?.stopPropagation()} okText="Delete" cancelText="Cancel" okButtonProps={{ danger: true }}>
          <Button type="text" size="small" icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} style={styles.deleteBtn} className="channel-delete-btn" />
        </Popconfirm>
      </div>
    ),
    icon: <span style={{ fontSize: 18 }}>{getChannelIcon(ch)}</span>,
  }));

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <h1 style={styles.title}>🏝️ Cove</h1>
        <p style={styles.subtitle}>island scenes</p>
      </div>

      <div style={styles.list}>
        {loading ? (
          <div style={styles.loading}><Spin tip="Loading scenes…" /></div>
        ) : (
          <>
            <Menu
              mode="inline"
              selectedKeys={activeChannelId ? [activeChannelId] : []}
              onClick={({ key }) => handleSelectChannel(key)}
              items={menuItems}
              style={styles.menu}
            />
            {adding ? (
              <form onSubmit={handleAddChannel} style={{ padding: 8, marginTop: 8 }}>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Channel name" autoFocus style={{ marginBottom: 8 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <Input value={newIcon} onChange={(e) => setNewIcon(e.target.value)} placeholder="Icon" style={{ width: 64 }} />
                  <Button type="primary" htmlType="submit" size="small" style={{ flex: 1 }}>Create</Button>
                  <Button size="small" onClick={() => setAdding(false)}>Cancel</Button>
                </div>
              </form>
            ) : (
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => setAdding(true)} block style={styles.addBtn}>
                New channel
              </Button>
            )}
          </>
        )}
      </div>

      <UserBar />
    </div>
  );
}
