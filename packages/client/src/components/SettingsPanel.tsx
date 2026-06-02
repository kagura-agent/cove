import { useUserStore } from "../stores/useUserStore";
import { useThemeStore, type ThemePreset } from "../stores/useThemeStore";
import { Drawer, Tabs, Typography, Button } from "antd";
import { BotManagement } from "./BotManagement";
import type { CSSProperties } from "react";

const THEME_PRESETS: { key: ThemePreset; label: string; preview: { bg: string; sidebar: string; accent: string } }[] = [
  { key: "dark", label: "Dark", preview: { bg: "#313338", sidebar: "#2b2d31", accent: "#5865f2" } },
  { key: "midnight", label: "Midnight", preview: { bg: "#1a191d", sidebar: "#111113", accent: "#5865f2" } },
];

const swatchContainerStyle: CSSProperties = {
  display: "flex", gap: 16, flexWrap: "wrap",
};

function ThemeSwatch({ preset, isActive, onSelect }: {
  preset: typeof THEME_PRESETS[number]; isActive: boolean; onSelect: () => void;
}) {
  const swatchStyle: CSSProperties = {
    width: 140,
    borderRadius: 8,
    overflow: "hidden",
    cursor: "pointer",
    border: isActive ? "2px solid var(--accent)" : "2px solid transparent",
    transition: "border-color 0.15s",
    boxShadow: isActive ? "0 0 0 2px var(--accent)" : "none",
  };

  const previewStyle: CSSProperties = {
    display: "flex",
    height: 80,
    background: preset.preview.bg,
  };

  const sidebarStyle: CSSProperties = {
    width: 36,
    background: preset.preview.sidebar,
    borderRight: "1px solid rgba(255,255,255,0.06)",
  };

  const contentStyle: CSSProperties = {
    flex: 1,
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    justifyContent: "center",
  };

  const lineStyle = (width: string): CSSProperties => ({
    height: 4,
    borderRadius: 2,
    width,
    background: "rgba(255,255,255,0.15)",
  });

  const accentLineStyle: CSSProperties = {
    height: 4,
    borderRadius: 2,
    width: "60%",
    background: preset.preview.accent,
    opacity: 0.7,
  };

  const labelStyle: CSSProperties = {
    textAlign: "center",
    padding: "8px 0",
    fontSize: 13,
    fontWeight: isActive ? 600 : 400,
    color: "var(--text-normal)",
    background: preset.preview.sidebar,
  };

  return (
    <div style={swatchStyle} onClick={onSelect}>
      <div style={previewStyle}>
        <div style={sidebarStyle} />
        <div style={contentStyle}>
          <div style={lineStyle("80%")} />
          <div style={lineStyle("50%")} />
          <div style={accentLineStyle} />
          <div style={lineStyle("70%")} />
        </div>
      </div>
      <div style={labelStyle}>{preset.label}</div>
    </div>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useThemeStore();

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Typography.Text strong style={{ fontSize: 13, display: "block", marginBottom: 12 }}>
          Theme
        </Typography.Text>
        <div style={swatchContainerStyle}>
          {THEME_PRESETS.map((preset) => (
            <ThemeSwatch
              key={preset.key}
              preset={preset}
              isActive={theme === preset.key}
              onSelect={() => setTheme(preset.key)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { username, logout } = useUserStore();

  return (
    <Drawer open={open} onClose={() => onOpenChange(false)} title="Settings" placement="right" width={400}>
      <Tabs
        items={[
          {
            key: "appearance",
            label: "Appearance",
            children: <AppearanceTab />,
          },
          {
            key: "profile",
            label: "Profile",
            children: (
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 8 }}>Signed in as</label>
                <Typography.Text strong>{username}</Typography.Text>
                <div style={{ marginTop: 16 }}>
                  <Button danger onClick={logout}>Sign out</Button>
                </div>
              </div>
            ),
          },
          {
            key: "bots",
            label: "Bots",
            children: <BotManagement />,
          },
        ]}
      />
    </Drawer>
  );
}
