import { useEffect, useState, useCallback } from "react";
import { ConfigProvider, theme, Button, Layout, message, Input } from "antd";
import { GoogleOutlined } from "@ant-design/icons";
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
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 20 } as CSSProperties,
  sider: { background: "var(--bg-surface)", borderRight: "1px solid rgba(255,255,255,0.08)", height: "100%" } as CSSProperties,
  content: { display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg-deep)" } as CSSProperties,
  connStatus: { display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", fontSize: 12, color: "var(--text-secondary)", background: "var(--bg-surface)", borderBottom: "1px solid rgba(255,255,255,0.08)" } as CSSProperties,
  loginPage: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 24 } as CSSProperties,
  loginTitle: { fontSize: 32, fontWeight: 700, color: "#f4a261" } as CSSProperties,
};

const connDot = (status: string): CSSProperties => ({
  width: 8, height: 8, borderRadius: "50%", display: "inline-block",
  background: status === "connecting" ? "#faad14" : "#ff4d4f",
});

const API_BASE = import.meta.env.VITE_COVE_API_URL ?? "";

function InviteCodePage({ pendingToken }: { pendingToken: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v10/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: code, pendingToken }),
      });
      if (!res.ok) {
        setError("Invalid or already used invite code");
        return;
      }
      const data = await res.json() as { token: string };
      localStorage.setItem("cove-token", data.token);
      window.history.replaceState({}, "", "/");
      window.location.reload();
    } catch {
      setError("Invalid or already used invite code");
    } finally {
      setLoading(false);
    }
  }, [code, pendingToken]);

  return (
    <div style={styles.loginPage}>
      <div style={styles.loginTitle}>Cove</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 300 }}>
        <Input
          placeholder="Enter invite code (COVE-XXXX-XXXX)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onPressEnter={handleSubmit}
          size="large"
          style={{ textAlign: "center", letterSpacing: 1 }}
        />
        <Button type="primary" size="large" onClick={handleSubmit} loading={loading}>
          Submit
        </Button>
        {error && <div style={{ color: "#ff4d4f", textAlign: "center" }}>{error}</div>}
      </div>
    </div>
  );
}

function LoginPage() {
  return (
    <div style={styles.loginPage}>
      <div style={styles.loginTitle}>Cove</div>
      <Button
        type="primary"
        size="large"
        icon={<GoogleOutlined />}
        onClick={() => { window.location.href = `${API_BASE}/api/auth/google`; }}
      >
        Sign in with Google
      </Button>
    </div>
  );
}

export default function App() {
  const { needsSetup, setUser } = useUserStore();
  const { channels, activeChannelId, setChannels, setActiveChannel } = useChannelStore();
  const connect = useWebSocketStore((s) => s.connect);
  const wsStatus = useWebSocketStore((s) => s.status);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const pending = params.get("pending");
    if (token) {
      localStorage.setItem("cove-token", token);
      window.history.replaceState({}, "", "/");
    }

    if (pending) {
      setPendingToken(pending);
      setAuthLoading(false);
      return;
    }

    if (localStorage.getItem("cove-token")) {
      api.fetchMe()
        .then((user) => {
          setUser(user);
        })
        .catch(() => {
          localStorage.removeItem("cove-token");
          useUserStore.setState({ needsSetup: true });
        })
        .finally(() => setAuthLoading(false));
    } else {
      setAuthLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    if (needsSetup || authLoading) return;
    setChannelsLoading(true);
    api.fetchChannels().then((chs) => {
      setChannels(chs);
      if (chs.length > 0) setActiveChannel(chs[0].id);
    }).catch(() => message.error("Failed to load scenes"))
      .finally(() => setChannelsLoading(false));
    connect();
  }, [needsSetup, authLoading, setChannels, setActiveChannel, connect]);

  if (authLoading) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div style={{ ...styles.fullHeight, ...styles.loginPage }}>
          <div style={styles.loginTitle}>Cove</div>
        </div>
      </ConfigProvider>
    );
  }

  if (pendingToken) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div style={styles.fullHeight}>
          <InviteCodePage pendingToken={pendingToken} />
        </div>
      </ConfigProvider>
    );
  }

  if (needsSetup) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div style={styles.fullHeight}>
          <LoginPage />
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
              <span>{wsStatus === "connecting" ? "Connecting..." : "Disconnected"}</span>
            </div>
          )}
          <ChatArea onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  );
}
