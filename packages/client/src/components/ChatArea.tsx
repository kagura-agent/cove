import { useChannelStore } from "../stores/useChannelStore";
import { useMessageStore } from "../stores/useMessageStore";
import { getChannelIcon } from "../lib/icons";
import { Typography, Button, Popconfirm } from "antd";
import { MenuOutlined, DeleteOutlined } from "@ant-design/icons";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import * as api from "../lib/api";
import type { CSSProperties } from "react";

const styles = {
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", gap: 12, opacity: 0.6 } as CSSProperties,
  wrapper: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" } as CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", background: "var(--bg-surface)", borderBottom: "1px solid rgba(255,255,255,0.08)", minHeight: 52 } as CSSProperties,
  menuBtn: { color: "var(--text-primary)" } as CSSProperties,
  clearBtn: { color: "var(--text-secondary)", opacity: 0.5 } as CSSProperties,
};

export function ChatArea({ onMenuClick }: { onMenuClick?: () => void }) {
  const { channels, activeChannelId } = useChannelStore();
  const setMessages = useMessageStore((s) => s.setMessages);
  const channel = channels.find((c) => c.id === activeChannelId);

  async function handleClear() {
    if (!channel) return;
    try {
      await api.clearMessages(channel.id);
      setMessages(channel.id, []);
    } catch (err) { console.error("clear:", err); }
  }

  if (!channel) {
    return (
      <div style={styles.empty}>
        <span style={{ fontSize: 48 }}>🌴</span>
        <p style={{ fontSize: 15 }}>Select a scene from the sidebar</p>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        {onMenuClick && <Button type="text" icon={<MenuOutlined />} onClick={onMenuClick} className="mobile-only" style={styles.menuBtn} />}
        <span style={{ fontSize: 28 }}>{getChannelIcon(channel)}</span>
        <div style={{ flex: 1 }}>
          <Typography.Title level={5} style={{ margin: 0, color: "var(--text-primary)" }}>{channel.name}</Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{channel.topic || "A cozy scene"}</Typography.Text>
        </div>
        <Popconfirm title="Clear all messages in this channel?" onConfirm={handleClear} okText="Clear" cancelText="Cancel" okButtonProps={{ danger: true }}>
          <Button type="text" icon={<DeleteOutlined />} style={styles.clearBtn} />
        </Popconfirm>
      </div>
      <MessageList channelId={channel.id} />
      <MessageInput channelId={channel.id} />
    </div>
  );
}
