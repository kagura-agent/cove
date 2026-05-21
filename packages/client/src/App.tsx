import { useEffect, useState } from "react";
import { ConfigProvider, theme, Modal, Input, Button, Layout } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import { useUserStore } from "./stores/useUserStore";
import { useChannelStore } from "./stores/useChannelStore";
import { useWebSocketStore } from "./stores/useWebSocketStore";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { getChannelIcon } from "./lib/icons";
import * as api from "./lib/api";

function UsernameDialog() {
  const [name, setName] = useState("");
  const setUser = useUserStore((s) => s.setUser);

  function handleSubmit() {
    setUser(name.trim() || "Islander");
  }

  return (
    <Modal open closable={false} footer={null} title="Welcome to Cove 🏝️" centered>
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 8 }}>
        <div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>What's your name?</p>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Islander" autoFocus size="large" />
        </div>
        <Button type="primary" htmlType="submit" block size="large">Enter Cove</Button>
      </form>
    </Modal>
  );
}

export default function App() {
  const needsSetup = useUserStore((s) => s.needsSetup);
  const { channels, activeChannelId, setChannels, setActiveChannel } = useChannelStore();
  const connect = useWebSocketStore((s) => s.connect);
  const wsStatus = useWebSocketStore((s) => s.status);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const activeChannel = channels.find((c) => c.id === activeChannelId);

  useEffect(() => {
    if (needsSetup) return;
    api.fetchChannels().then((chs) => {
      setChannels(chs);
      if (chs.length > 0) setActiveChannel(chs[0].id);
    }).catch(console.error);
    connect();
  }, [needsSetup, setChannels, setActiveChannel, connect]);

  if (needsSetup) {
    return (
      <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: "#f4a261", colorBgContainer: "var(--bg-surface)", colorBgElevated: "var(--bg-elevated)" } }}>
        <div style={{ height: "100%", background: "var(--bg-deep)" }}>
          <UsernameDialog />
        </div>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: "#f4a261", colorBgContainer: "var(--bg-surface)", colorBgElevated: "var(--bg-elevated)" } }}>
      <Layout style={{ height: "100%", background: "var(--bg-deep)" }}>
        {/* Mobile header */}
        <div className="mobile-header" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 10, display: "flex", alignItems: "center", gap: 12, padding: "0 14px", height: 52, background: "var(--bg-surface)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <Button type="text" icon={<MenuOutlined />} onClick={() => setSidebarOpen(!sidebarOpen)} style={{ color: "var(--text-primary)" }} />
          <h1 style={{ flex: 1, fontSize: 18, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0, color: "var(--text-primary)" }}>
            {activeChannel ? `${getChannelIcon(activeChannel)} ${activeChannel.name}` : "Cove 🏝️"}
          </h1>
        </div>

        {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 20 }} />}

        <Layout.Sider
          width={260}
          className={sidebarOpen ? "sidebar-open" : ""}
          style={{
            background: "var(--bg-surface)",
            borderRight: "1px solid rgba(255,255,255,0.08)",
            height: "100%",
          }}
          breakpoint="sm"
          collapsedWidth={0}
          trigger={null}
        >
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </Layout.Sider>

        <Layout.Content style={{ display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg-deep)" }}>
          {wsStatus !== "connected" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", fontSize: 12, color: "var(--text-secondary)", background: "var(--bg-surface)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: wsStatus === "connecting" ? "#faad14" : "#ff4d4f", display: "inline-block" }} />
              <span>{wsStatus === "connecting" ? "Connecting…" : "Disconnected"}</span>
            </div>
          )}
          <ChatArea />
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  );
}
