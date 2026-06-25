import { useState, useEffect, useCallback } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRoleStore } from "../stores/useRoleStore";
import { useUserPermissions } from "../lib/useUserPermissions";
import * as api from "../lib/api";
import { RoleList } from "./RoleList";
import { RoleEditor } from "./RoleEditor";
import { MembersRoleSection } from "./MembersRoleSection";

/* ── Nav sections ───────────────────────────────────────────── */

type SectionKey = "roles" | "members";

interface NavItem {
  key: SectionKey;
  label: string;
  header: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: "roles", label: "Roles", header: "SERVER SETTINGS" },
  { key: "members", label: "Members", header: "USER MANAGEMENT" },
];

/* ── Section content components ─────────────────────────────── */

function RolesSection({ guildId }: { guildId: string }) {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const { userHighestPosition, userPermissions } = useUserPermissions(guildId);

  // Fetch roles on mount
  useEffect(() => {
    api.fetchRoles(guildId).then((r) => useRoleStore.getState().setRoles(guildId, r)).catch(() => alert("Failed to load roles"));
  }, [guildId]);

  return (
    <div>
      <h2 style={sectionTitleStyle}>Roles</h2>
      <div style={rolesSectionStyle}>
        <RoleList
          guildId={guildId}
          selectedRoleId={selectedRoleId}
          onSelectRole={setSelectedRoleId}
          userHighestPosition={userHighestPosition}
        />
        {selectedRoleId ? (
          <RoleEditor
            guildId={guildId}
            roleId={selectedRoleId}
            userHighestPosition={userHighestPosition}
            userPermissions={userPermissions}
          />
        ) : (
          <div style={{ color: "var(--text-muted)", padding: "var(--space-lg)", flex: 1 }}>
            Select a role to edit its settings.
          </div>
        )}
      </div>
    </div>
  );
}

function MembersSection({ guildId }: { guildId: string }) {
  const { userHighestPosition } = useUserPermissions(guildId);
  return <MembersRoleSection guildId={guildId} userHighestPosition={userHighestPosition} />;
}

const sectionTitleStyle: CSSProperties = {
  fontSize: "var(--font-size-xl)",
  fontWeight: 600,
  color: "var(--text-normal)",
  marginBottom: "var(--space-xl)",
  marginTop: 0,
};

const SECTION_COMPONENTS: Record<SectionKey, (guildId: string) => ReactNode> = {
  roles: (guildId) => <RolesSection guildId={guildId} />,
  members: (guildId) => <MembersSection guildId={guildId} />,
};

/* ── Main Server Settings Panel ─────────────────────────────── */

export function ServerSettings({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const [activeSection, setActiveSection] = useState<SectionKey>("roles");

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [close]);

  return (
    <div className="settings-backdrop" onClick={close}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button onClick={close} className="settings-close-btn" aria-label="Close server settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Sidebar */}
        <div className="settings-sidebar">
          {NAV_ITEMS.map((item, idx) => {
            const prevHeader = idx > 0 ? NAV_ITEMS[idx - 1].header : null;
            const showHeader = item.header !== prevHeader;
            return (
              <div key={item.key}>
                {showHeader && (
                  <>
                    {idx > 0 && <div className="settings-divider" style={dividerStyle} />}
                    <div className="settings-category-header" style={categoryHeaderStyle}>
                      {item.header}
                    </div>
                  </>
                )}
                <button
                  onClick={() => setActiveSection(item.key)}
                  className={`settings-nav-item${activeSection === item.key ? " active" : ""}`}
                  style={{
                    color: activeSection === item.key ? "var(--text-normal)" : "var(--text-muted)",
                  }}
                >
                  {item.label}
                </button>
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div className="settings-content">
          <div style={contentInnerStyle}>
            {SECTION_COMPONENTS[activeSection](guildId)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

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

const rolesSectionStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-xl)",
};
