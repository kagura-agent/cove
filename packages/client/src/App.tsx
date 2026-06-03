import { useEffect, useState, useCallback } from "react";
import { ConfigProvider, theme, Button, Input, message } from "antd";
import { GoogleOutlined } from "@ant-design/icons";
import { useUserStore } from "./stores/useUserStore";
import { useChannelStore } from "./stores/useChannelStore";
import { useWebSocketStore } from "./stores/useWebSocketStore";
import { useThemeStore } from "./stores/useThemeStore";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { MemberList } from "./components/MemberList";
import { SettingsPanel } from "./components/SettingsPanel";
import * as api from "./lib/api";
import type { CSSProperties } from "react";

function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const offset = window.innerHeight - vv.height;
      document.documentElement.style.setProperty("--keyboard-offset", `${Math.max(0, offset)}px`);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.documentElement.style.setProperty("--keyboard-offset", "0px");
    };
  }, []);
}

const ACCENT_BRAND: Record<string, string> = {
  light: "#e07828", dark: "#f4a261", midnight: "#f4a261",
};

function useAntdThemeConfig() {
  const currentTheme = useThemeStore((s) => s.theme);
  return {
    algorithm: currentTheme === "light" ? theme.defaultAlgorithm : theme.darkAlgorithm,
    token: { colorPrimary: ACCENT_BRAND[currentTheme] || "#f4a261", colorBgContainer: "var(--bg-secondary)", colorBgElevated: "var(--bg-tertiary)" },
  };
}

const styles = {
  fullHeight: { height: "100%", background: "var(--bg-primary)" } as CSSProperties,
  overlay: { position: "fixed", inset: 0, background: "var(--bg-overlay-strong)", zIndex: 20, opacity: 0, pointerEvents: "none" as const, transition: "opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)" } as CSSProperties,
  overlayVisible: { opacity: 1, pointerEvents: "auto" as const } as CSSProperties,
  layout: { display: "flex", height: "100%", overflow: "hidden" } as CSSProperties,
  chatColumn: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, height: "100%", background: "var(--bg-primary)" } as CSSProperties,
  connStatus: { display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", fontSize: 12, color: "var(--text-muted)", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)" } as CSSProperties,
  loginPage: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 24 } as CSSProperties,
  loginTitle: { fontSize: 32, fontWeight: 700, color: "var(--accent-brand)" } as CSSProperties,
};

const connDot = (status: string): CSSProperties => ({
  width: 8, height: 8, borderRadius: "50%", display: "inline-block",
  background: status === "connecting" ? "var(--warning)" : "var(--danger)",
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
        body: JSON.stringify({ inviteCode: code.trim().toUpperCase(), pendingToken }),
      });
      if (!res.ok) {
        setError(res.status === 400 ? "Invalid or already used invite code" : "Something went wrong, please try again");
        return;
      }
      const data = await res.json() as { token: string };
      localStorage.setItem("cove-token", data.token);
      window.history.replaceState({}, "", "/");
      window.location.reload();
    } catch {
      setError("Network error, please try again");
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
        {error && <div style={{ color: "var(--danger)", textAlign: "center" }}>{error}</div>}
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
  const themeConfig = useAntdThemeConfig();
  useVisualViewport();
  const { needsSetup, setUser } = useUserStore();
  const { setChannels, setActiveChannel } = useChannelStore();
  const connect = useWebSocketStore((s) => s.connect);
  const wsStatus = useWebSocketStore((s) => s.status);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      <div style={styles.fullHeight}>
        <div onClick={() => setSidebarOpen(false)} style={{...styles.overlay, ...(sidebarOpen ? styles.overlayVisible : {})}} className="mobile-sidebar-backdrop" />
        <div onClick={() => setMembersOpen(false)} style={{...styles.overlay, ...(membersOpen ? styles.overlayVisible : {})}} className="mobile-members-backdrop" />

        <div style={styles.layout} className={`${sidebarOpen ? "sidebar-open" : ""} ${membersOpen ? "members-open" : ""}`}>
          <Sidebar onClose={() => setSidebarOpen(false)} loading={channelsLoading} onSettingsOpen={() => setSettingsOpen(true)} />

          <div style={styles.chatColumn}>
            {wsStatus !== "connected" && (
              <div style={styles.connStatus}>
                <span style={connDot(wsStatus)} />
                <span>{wsStatus === "connecting" ? "Connecting..." : "Disconnected"}</span>
              </div>
            )}
            <ChatArea onMenuClick={() => setSidebarOpen(!sidebarOpen)} onMembersClick={() => setMembersOpen(!membersOpen)} membersOpen={membersOpen} />
          </div>

          {membersOpen && <MemberList />}
        </div>

        <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>
    </ConfigProvider>
  );
}
