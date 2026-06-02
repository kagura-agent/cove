import { useState, useEffect, useCallback } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useUserStore } from "../stores/useUserStore";
import { useThemeStore, type ThemePreset } from "../stores/useThemeStore";
import { BotManagement } from "./BotManagement";

/* ── Theme presets ──────────────────────────────────────────── */

const THEME_PRESETS: { key: ThemePreset; label: string; preview: { bg: string; sidebar: string; accent: string; isLight?: boolean } }[] = [
  { key: "light", label: "Light", preview: { bg: "#ffffff", sidebar: "#f2f3f5", accent: "#5865f2", isLight: true } },
  { key: "dark", label: "Dark", preview: { bg: "#313338", sidebar: "#2b2d31", accent: "#5865f2" } },
  { key: "midnight", label: "Midnight", preview: { bg: "#1a191d", sidebar: "#111113", accent: "#5865f2" } },
];

/* ── Nav sections ───────────────────────────────────────────── */

type SectionKey = "appearance" | "profile" | "bots";

interface NavItem {
  key: SectionKey;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: "appearance", label: "Appearance" },
  { key: "profile", label: "Profile" },
  { key: "bots", label: "Bots" },
];

/* ── ThemeSwatch (unchanged) ────────────────────────────────── */

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
    borderRight: preset.preview.isLight ? "1px solid rgba(0,0,0,0.08)" : "1px solid rgba(255,255,255,0.06)",
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
    background: preset.preview.isLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.15)",
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
    color: preset.preview.isLight ? "#313338" : "var(--text-normal)",
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

/* ── Section content components ─────────────────────────────── */

function AppearanceSection() {
  const { theme, setTheme } = useThemeStore();

  return (
    <div>
      <h2 style={sectionTitleStyle}>Appearance</h2>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em", color: "var(--text-muted)", marginBottom: 12 }}>
          Theme
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
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

function ProfileSection() {
  const { username } = useUserStore();

  return (
    <div>
      <h2 style={sectionTitleStyle}>Profile</h2>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em", color: "var(--text-muted)", marginBottom: 8 }}>
        Signed in as
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-normal)" }}>{username}</div>
    </div>
  );
}

function BotsSection() {
  return (
    <div>
      <h2 style={sectionTitleStyle}>Bots</h2>
      <BotManagement />
    </div>
  );
}

const sectionTitleStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  color: "var(--text-normal)",
  marginBottom: 20,
  marginTop: 0,
};

const SECTION_COMPONENTS: Record<SectionKey, () => ReactNode> = {
  appearance: () => <AppearanceSection />,
  profile: () => <ProfileSection />,
  bots: () => <BotsSection />,
};

/* ── Main Settings Panel ────────────────────────────────────── */

export function SettingsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [activeSection, setActiveSection] = useState<SectionKey>("appearance");
  const { logout } = useUserStore();

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  if (!open) return null;

  const { username } = useUserStore();
  const avatarLetter = username ? username[0].toUpperCase() : "?";

  return (
    <div style={backdropStyle} onClick={close}>
      {/* Floating panel */}
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        {/* Close button — top-right of panel */}
        <button onClick={close} style={closeButtonStyle} aria-label="Close settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Sidebar */}
        <div style={sidebarContainerStyle}>
          {/* User profile area */}
          <div style={profileAreaStyle}>
            <div style={avatarStyle}>{avatarLetter}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-normal)" }}>{username}</div>
          </div>
          <div style={dividerStyle} />
          <div style={categoryHeaderStyle}>USER SETTINGS</div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveSection(item.key)}
              style={{
                ...navItemStyle,
                background: activeSection === item.key ? "var(--bg-modifier-active)" : "transparent",
                color: activeSection === item.key ? "var(--text-normal)" : "var(--text-muted)",
                fontWeight: activeSection === item.key ? 600 : 400,
              }}
              onMouseEnter={(e) => {
                if (activeSection !== item.key) {
                  e.currentTarget.style.background = "var(--bg-modifier-hover)";
                  e.currentTarget.style.color = "var(--text-normal)";
                }
              }}
              onMouseLeave={(e) => {
                if (activeSection !== item.key) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-muted)";
                }
              }}
            >
              {item.label}
            </button>
          ))}
          <div style={dividerStyle} />
          <button onClick={() => { logout(); close(); }} style={signOutStyle}>
            Sign Out
          </button>
        </div>

        {/* Content */}
        <div style={contentContainerStyle}>
          <div style={contentInnerStyle}>
            {SECTION_COMPONENTS[activeSection]()}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0, 0, 0, 0.6)",
  backdropFilter: "blur(2px)",
};

const panelStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  width: "calc(100vw - 80px)",
  maxWidth: 960,
  height: "calc(100vh - 80px)",
  maxHeight: 720,
  borderRadius: 10,
  overflow: "hidden",
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2)",
};

const sidebarContainerStyle: CSSProperties = {
  width: 220,
  flexShrink: 0,
  background: "var(--bg-secondary, #2b2d31)",
  display: "flex",
  flexDirection: "column",
  padding: "16px 12px",
  overflowY: "auto",
};

const profileAreaStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
};

const avatarStyle: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: "50%",
  background: "var(--accent, #5865f2)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 16,
  fontWeight: 700,
  flexShrink: 0,
};

const categoryHeaderStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  color: "var(--text-muted)",
  padding: "6px 10px",
  marginBottom: 2,
};

const navItemStyle: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  border: "none",
  borderRadius: 4,
  padding: "6px 10px",
  fontSize: 15,
  cursor: "pointer",
  marginBottom: 2,
  transition: "background 0.1s, color 0.1s",
};

const dividerStyle: CSSProperties = {
  height: 1,
  background: "var(--bg-modifier-hover, rgba(255,255,255,0.06))",
  margin: "8px 10px",
};

const signOutStyle: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  border: "none",
  background: "transparent",
  borderRadius: 4,
  padding: "6px 10px",
  fontSize: 15,
  color: "#ed4245",
  cursor: "pointer",
  fontWeight: 400,
  transition: "background 0.1s",
};

const contentContainerStyle: CSSProperties = {
  flex: 1,
  background: "var(--bg-primary, #313338)",
  padding: "32px 40px",
  overflowY: "auto",
};

const contentInnerStyle: CSSProperties = {
  maxWidth: 660,
  width: "100%",
};

const closeButtonStyle: CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  width: 32,
  height: 32,
  borderRadius: "50%",
  border: "1px solid var(--text-muted)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  zIndex: 1,
  transition: "border-color 0.15s, color 0.15s",
};
