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

  return (
    <div style={overlayStyle}>
      {/* Sidebar */}
      <div style={sidebarContainerStyle}>
        <div style={sidebarInnerStyle}>
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
      </div>

      {/* Content */}
      <div style={contentContainerStyle}>
        <div style={contentInnerStyle}>
          {SECTION_COMPONENTS[activeSection]()}
        </div>
        {/* Close button */}
        <button onClick={close} style={closeButtonStyle} aria-label="Close settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: "var(--text-muted)" }}>ESC</div>
        </button>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  background: "var(--bg-tertiary, #1e1f22)",
};

const sidebarContainerStyle: CSSProperties = {
  flex: "1 1 50%",
  background: "var(--bg-secondary, #2b2d31)",
  display: "flex",
  justifyContent: "flex-end",
  padding: "60px 20px 20px 20px",
  overflowY: "auto",
};

const sidebarInnerStyle: CSSProperties = {
  width: 220,
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
  flex: "1 1 50%",
  background: "var(--bg-primary, #313338)",
  display: "flex",
  alignItems: "flex-start",
  padding: "60px 40px 20px 40px",
  overflowY: "auto",
};

const contentInnerStyle: CSSProperties = {
  maxWidth: 740,
  width: "100%",
  flex: "0 1 740px",
};

const closeButtonStyle: CSSProperties = {
  flexShrink: 0,
  marginTop: 0,
  marginLeft: 20,
  width: 36,
  height: 36,
  borderRadius: "50%",
  border: "1px solid var(--text-muted)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  transition: "border-color 0.15s, color 0.15s",
};
