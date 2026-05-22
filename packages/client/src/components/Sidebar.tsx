import { useChannelStore } from "../stores/useChannelStore";
import { getChannelIcon } from "../lib/icons";
import { Button, Input, Menu, Popconfirm } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { UserBar } from "./UserBar";
import * as api from "../lib/api";
import { useState } from "react";

export function Sidebar({ onClose }: { onClose?: () => void }) {
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.name}</span>
        <Popconfirm title={`Delete #${ch.name}?`} description="All messages will be lost." onConfirm={(e) => { e?.stopPropagation(); handleDeleteChannel(ch.id); }} onCancel={(e) => e?.stopPropagation()} okText="Delete" cancelText="Cancel" okButtonProps={{ danger: true }}>
          <Button type="text" size="small" icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} style={{ opacity: 0.4, fontSize: 12 }} className="channel-delete-btn" />
        </Popconfirm>
      </div>
    ),
    icon: <span style={{ fontSize: 18 }}>{getChannelIcon(ch)}</span>,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)" }}>
      <div style={{ padding: "20px 20px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>🏝️ Cove</h1>
        <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>island scenes</p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        <Menu
          mode="inline"
          selectedKeys={activeChannelId ? [activeChannelId] : []}
          onClick={({ key }) => handleSelectChannel(key)}
          items={menuItems}
          style={{ background: "transparent", border: "none" }}
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
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => setAdding(true)} block style={{ marginTop: 8, opacity: 0.6 }}>
            New channel
          </Button>
        )}
      </div>

      <UserBar />
    </div>
  );
}
