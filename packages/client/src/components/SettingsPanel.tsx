import { useState, useEffect, useCallback } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useUserStore } from "../stores/useUserStore";
import { useThemeStore } from "../stores/useThemeStore";
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
    height: 80, /* swatch preview dimensions */
    background: preset.preview.bg,
  };

  const sidebarStyle: CSSProperties = {
    width: 36, /* swatch preview dimensions */
    background: preset.preview.sidebar,
    borderRight: `1px solid ${preset.preview.borderColor}`,
  };

  const contentStyle: CSSProperties = {
    flex: 1,
    padding: "var(--space-sm)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-xs)",
    justifyContent: "center",
  };

  const lineStyle = (width: string): CSSProperties => ({
    height: "var(--space-xs)",
    borderRadius: "var(--space-xxs)",
    width,
    background: preset.preview.lineColor,
  });

  const accentLineStyle: CSSProperties = {
    height: "var(--space-xs)",
    borderRadius: "var(--space-xxs)",
    width: "60%",
    background: preset.preview.accent,
    opacity: 0.7,
  };

  const labelStyle: CSSProperties = {
    textAlign: "center",
    padding: "var(--space-sm) 0",
    fontSize: "var(--font-size-sm)",
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
      <div style={{ marginBottom: "var(--space-lg)" }}>
        <div style={categoryLabelStyle}>Theme</div>
        <div style={{ display: "flex", gap: "var(--space-lg)", flexWrap: "wrap" }}>
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
      <div style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--text-normal)" }}>{username}</div>
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
  fontSize: "var(--font-size-xl)",
  fontWeight: 600,
  color: "var(--text-normal)",
  marginBottom: "var(--space-xl)",
  marginTop: 0,
};

const categoryLabelStyle: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  color: "var(--text-muted)",
  marginBottom: "var(--space-md)",
};

const SECTION_COMPONENTS: Record<SectionKey, () => ReactNode> = {
  appearance: () => <AppearanceSection />,
  profile: () => <ProfileSection />,
  bots: () => <BotsSection />,
};

/* ── Main Settings Panel ────────────────────────────────────── */

export function SettingsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [activeSection, setActiveSection] = useState<SectionKey>("appearance");
  const { logout, username } = useUserStore();
  const avatarLetter = username ? username[0].toUpperCase() : "?";

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

  return (
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
          <div style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--text-normal)" }}>{username}</div>
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
            {/* Mobile-only sign out at bottom of content */}
            <div className="settings-mobile-sign-out">
              <div style={{ ...dividerStyle, margin: "var(--space-xxl) 0 var(--space-lg)" }} />
              <button
                onClick={() => { logout(); close(); }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--danger)",
                  fontSize: "var(--font-size-lg)",
                  cursor: "pointer",
                  padding: "var(--space-sm) 0",
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const profileAreaStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-sm) var(--space-sm)",
};

const avatarStyle: CSSProperties = {
  width: "var(--icon-button-size-md)",
  height: "var(--icon-button-size-md)",
  borderRadius: "50%",
  background: "var(--accent)",
  color: "var(--text-on-accent)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "var(--font-size-lg)",
  fontWeight: 700,
  flexShrink: 0,
};

const categoryHeaderStyle: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  color: "var(--text-muted)",
  padding: "var(--space-xs) var(--space-sm)",
  marginBottom: "var(--space-xxs)",
};

const dividerStyle: CSSProperties = {
  height: 1,
  background: "var(--bg-modifier-hover)",
  margin: "var(--space-sm) var(--space-sm)",
};

const contentInnerStyle: CSSProperties = {
  maxWidth: "var(--settings-content-max-width)",
  width: "100%",
};
