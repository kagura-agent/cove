import { useChannelStore } from "../stores/useChannelStore";
import { getChannelIcon } from "../lib/icons";
import { Typography } from "antd";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";

export function ChatArea() {
  const { channels, activeChannelId } = useChannelStore();
  const channel = channels.find((c) => c.id === activeChannelId);

  if (!channel) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", gap: 12, opacity: 0.6 }}>
        <span style={{ fontSize: 48 }}>🌴</span>
        <p style={{ fontSize: 15 }}>Select a scene from the sidebar</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", background: "var(--bg-surface)", borderBottom: "1px solid rgba(255,255,255,0.08)", minHeight: 52 }}>
        <span style={{ fontSize: 28 }}>{getChannelIcon(channel)}</span>
        <div style={{ flex: 1 }}>
          <Typography.Title level={5} style={{ margin: 0, color: "var(--text-primary)" }}>{channel.name}</Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{channel.topic || "A cozy scene"}</Typography.Text>
        </div>
      </div>
      <MessageList channelId={channel.id} />
      <MessageInput channelId={channel.id} />
    </div>
  );
}
