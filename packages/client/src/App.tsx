import { useEffect, useState } from "react";
import { ConfigProvider, theme, Modal, Input, Button, Layout, Spin, message } from "antd";
import { useUserStore } from "./stores/useUserStore";
import { useChannelStore } from "./stores/useChannelStore";
import { useWebSocketStore } from "./stores/useWebSocketStore";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import * as api from "./lib/api";
import type { CSSProperties } from "react";

const themeConfig = {
  algorithm: theme.darkAlgorithm,
  token: { colorPrimary: "#f4a261", colorBgContainer: "var(--bg-surface)", colorBgElevated: "var(--bg-elevated)" },
};

const styles = {
  fullHeight: { height: "100%", background: "var(--bg-deep)" } as CSSProperties,
  dialogForm: { display: "flex", flexDirection: "column", gap: 16, marginTop: 8 } as CSSProperties,
  dialogHint: { fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 } as CSSProperties,
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 20 } as CSSProperties,
  sider: { background: "var(--bg-surface)", borderRight: "1px solid rgba(255,255,255,0.08)", height: "100%" } as CSSProperties,
  content: { display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg-deep)" } as CSSProperties,
  connStatus: { display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", fontSize: 12, color: "var(--text-secondary)", background: "var(--bg-surface)", borderBottom: "1px solid rgba(255,255,255,0.08)" } as CSSProperties,
};

const connDot = (status: string): CSSProperties => ({
  width: 8, height: 8, borderRadius: "50%", display: "inline-block",
  background: status === "connecting" ? "#faad14" : "#ff4d4f",
});

function UsernameDialog() {
  const [name, setName] = useState("");
  const setUser = useUserStore((s) => s.setUser);

  function handleSubmit() {
    setUser(name.trim() || "Islander");
  }

  return (
    <Modal open closable={false} footer={null} title="Welcome to Cove 🏝️" centered>
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} style={styles.dialogForm}>
        <div>
          <p style={styles.dialogHint}>What's your name?</p>
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
  const [channelsLoading, setChannelsLoading] = useState(true);

  useEffect(() => {
    if (needsSetup) return;
    setChannelsLoading(true);
    api.fetchChannels().then((chs) => {
      setChannels(chs);
      if (chs.length > 0) setActiveChannel(chs[0].id);
    }).catch(() => message.error("Failed to load scenes"))
      .finally(() => setChannelsLoading(false));
    connect();
  }, [needsSetup, setChannels, setActiveChannel, connect]);

  if (needsSetup) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div style={styles.fullHeight}>
          <UsernameDialog />
        </div>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={themeConfig}>
      <Layout style={styles.fullHeight}>
        {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={styles.overlay} />}

        <Layout.Sider width={260} className={sidebarOpen ? "sidebar-open" : ""} style={styles.sider} trigger={null}>
          <Sidebar onClose={() => setSidebarOpen(false)} loading={channelsLoading} />
        </Layout.Sider>

        <Layout.Content style={styles.content}>
          {wsStatus !== "connected" && (
            <div style={styles.connStatus}>
              <span style={connDot(wsStatus)} />
              <span>{wsStatus === "connecting" ? "Connecting…" : "Disconnected"}</span>
            </div>
          )}
          <ChatArea onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  );
}
