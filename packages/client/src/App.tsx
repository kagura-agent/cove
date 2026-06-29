import { useEffect, useState, useCallback } from "react";
import { RouterProvider } from "react-router-dom";
import { ConfigProvider, theme, Button, Input } from "antd";
import { GoogleOutlined } from "@ant-design/icons";
import { useUserStore } from "./stores/useUserStore";
import { useChannelStore } from "./stores/useChannelStore";
import { useGuildStore } from "./stores/useGuildStore";
import { useWebSocketStore } from "./stores/useWebSocketStore";
import { useThemeStore } from "./stores/useThemeStore";
import { router, getActiveIdsFromRouter } from "./lib/router";
import { routes } from "./lib/routes";
import { setupGatewaySubscriptions, teardownGatewaySubscriptions } from "./lib/gateway-subscriptions";
import * as api from "./lib/api";
import { API_PREFIX } from "@cove/shared";
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

function useAntdThemeConfig() {
  const currentTheme = useThemeStore((s) => s.theme);
  const accentBrand = getComputedStyle(document.documentElement).getPropertyValue("--accent-brand").trim() || "#f4a261";
  return {
    algorithm: currentTheme === "light" ? theme.defaultAlgorithm : theme.darkAlgorithm,
    token: { colorPrimary: accentBrand, colorBgContainer: "var(--bg-secondary)", colorBgElevated: "var(--bg-tertiary)" },
  };
}

const styles = {
  fullHeight: { height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-primary)" } as CSSProperties,
  loginPage: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "var(--space-xxl)" } as CSSProperties,
  loginTitle: { fontSize: "var(--font-size-xxl)", fontWeight: 700, color: "var(--accent-brand)" } as CSSProperties,
};

const API_BASE = import.meta.env.VITE_COVE_API_URL ?? "";

function InviteCodePage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}${API_PREFIX}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: code.trim().toUpperCase() }),
        credentials: "include",
      });
      if (!res.ok) {
        setError(res.status === 400 ? "Invalid or already used invite code" : "Something went wrong, please try again");
        return;
      }
      window.location.reload();
    } catch {
      setError("Network error, please try again");
    } finally {
      setLoading(false);
    }
  }, [code]);

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
        onClick={() => {
          sessionStorage.setItem("cove_return_path", window.location.pathname);
          window.location.href = `${API_BASE}/api/auth/google`;
        }}
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
  const connect = useWebSocketStore((s) => s.connect);
  const [authLoading, setAuthLoading] = useState(true);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    localStorage.removeItem("cove-token");
    localStorage.removeItem("cove-user");

    const params = new URLSearchParams(window.location.search);
    if (params.has("token") || params.has("pending")) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    api.fetchPendingStatus()
      .then((status) => {
        if (status.pending) {
          setIsPending(true);
          setAuthLoading(false);
          return;
        }
        return api.fetchMe()
          .then((user) => {
            setUser(user);
          })
          .catch(() => {
            useUserStore.setState({ needsSetup: true });
          });
      })
      .catch(() => {
        useUserStore.setState({ needsSetup: true });
      })
      .finally(() => setAuthLoading(false));
  }, [setUser]);

  // After auth, restore saved path from OAuth flow
  useEffect(() => {
    if (authLoading || needsSetup || isPending) return;
    const returnPath = sessionStorage.getItem("cove_return_path");
    if (returnPath && returnPath !== "/") {
      sessionStorage.removeItem("cove_return_path");
      router.navigate(returnPath, { replace: true });
    }
  }, [authLoading, needsSetup, isPending]);

  useEffect(() => {
    if (needsSetup || authLoading) return;
    setupGatewaySubscriptions();
    connect();

    // Fallback: if READY isn't received within 8s, load channels via REST
    const fallbackTimer = setTimeout(() => {
      const guildStore = useGuildStore.getState();
      const guildIds = Object.keys(guildStore.guilds);
      if (guildIds.length === 0) return;
      const guildId = guildIds[0];
      const currentChannels = useChannelStore.getState().getChannels(guildId);
      if (currentChannels.length === 0) {
        api.fetchChannels(guildId)
          .then((chs) => {
            if (useChannelStore.getState().getChannels(guildId).length === 0) {
              useChannelStore.getState().setChannels(guildId, chs);
              const { channelId } = getActiveIdsFromRouter();
              if (!channelId && chs.length > 0) {
                router.navigate(routes.channel(guildId, chs[0].id), { replace: true });
              }
            }
          })
          .catch(() => {});
      }
    }, 8000);

    return () => {
      clearTimeout(fallbackTimer);
      teardownGatewaySubscriptions();
    };
  }, [needsSetup, authLoading, connect]);

  if (authLoading) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div style={{ ...styles.fullHeight, ...styles.loginPage }}>
          <div style={styles.loginTitle}>Cove</div>
        </div>
      </ConfigProvider>
    );
  }

  if (isPending) {
    return (
      <ConfigProvider theme={themeConfig}>
        <div style={styles.fullHeight}>
          <InviteCodePage />
        </div>
      </ConfigProvider>
    );
  }

  // Allow /onboarding-preview without auth
  if (window.location.pathname === "/onboarding-preview") {
    return (
      <ConfigProvider theme={themeConfig}>
        <RouterProvider router={router} />
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
      <RouterProvider router={router} />
    </ConfigProvider>
  );
}
