import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";
import { useUserStore } from "../stores/useUserStore";
import { useThemeStore, type ThemePreset } from "../stores/useThemeStore";
import { BotManagement } from "./BotManagement";
import { THEME_PRESETS, type ThemePreviewData } from "../lib/theme-previews";

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

/* ── ThemeSwatch ────────────────────────────────────────────── */

function ThemeSwatch({ preset, isActive, onSelect }: {
  preset: ThemePreviewData; isActive: boolean; onSelect: () => void;
}) {
  const previewStyle: CSSProperties = {
    display: "flex",
    height: 80,
    background: preset.preview.bg,
  };

  const sidebarStyle: CSSProperties = {
    width: 36,
    background: preset.preview.sidebar,
    borderRight: `1px solid ${preset.preview.borderColor}`,
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
    background: preset.preview.lineColor,
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
    color: preset.preview.labelColor,
    background: preset.preview.sidebar,
  };

  return (
    <div className={`theme-swatch${isActive ? " active" : ""}`} onClick={onSelect}>
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
        <div style={categoryLabelStyle}>Theme</div>
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
      <div style={categoryLabelStyle}>Signed in as</div>
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

const categoryLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  color: "var(--text-muted)",
  marginBottom: 12,
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

  return createPortal(
    <div className="settings-backdrop" onClick={close}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button onClick={close} className="settings-close-btn" aria-label="Close settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Sidebar */}
        <div className="settings-sidebar">
          <div className="settings-profile-area" style={profileAreaStyle}>
            <div style={avatarStyle}>{avatarLetter}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-normal)" }}>{username}</div>
          </div>
          <div className="settings-divider" style={dividerStyle} />
          <div className="settings-category-header" style={categoryHeaderStyle}>USER SETTINGS</div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveSection(item.key)}
              className={`settings-nav-item${activeSection === item.key ? " active" : ""}`}
              style={{
                color: activeSection === item.key ? "var(--text-normal)" : "var(--text-muted)",
              }}
            >
              {item.label}
            </button>
          ))}
          <div className="settings-divider" style={dividerStyle} />
          <button onClick={() => { logout(); close(); }} className="settings-sign-out">
            Sign Out
          </button>
        </div>

        {/* Content */}
        <div className="settings-content">
          <div style={contentInnerStyle}>
            {SECTION_COMPONENTS[activeSection]()}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

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
  background: "var(--accent)",
  color: "var(--text-on-accent)",
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

const dividerStyle: CSSProperties = {
  height: 1,
  background: "var(--bg-modifier-hover)",
  margin: "8px 10px",
};

const contentInnerStyle: CSSProperties = {
  maxWidth: 660,
  width: "100%",
};
