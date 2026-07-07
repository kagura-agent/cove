# Spec: Remove server name header from sidebar

**Issue:** #449
**Status:** Draft

## Problem

The sidebar currently displays a header bar at the top containing:
- 🏝️ emoji
- Guild/server name (e.g. "Yueying Chen (Luna Chen)'s Server")
- Settings gear icon (⚙️)

This takes up vertical space (`var(--header-height)`) and displays the server name which is not useful in Cove's single-server context.

## Current Implementation

`packages/client/src/components/Sidebar.tsx` lines 136–149:

```tsx
<div style={styles.header}>
  <span style={{ fontSize: "var(--font-size-xl)" }}>🏝️</span>
  <h1 style={styles.title}>{guilds[guildId ?? ""]?.name ?? "Cove"}</h1>
  {guildId && canSeeSettings && (
    <Button
      type="text" size="small"
      icon={<SettingOutlined />}
      onClick={() => setServerSettingsOpen(true)}
      aria-label="Server settings"
      style={{ marginLeft: "auto", ... }}
    />
  )}
</div>
```

## Proposal

Remove the entire header `<div style={styles.header}>` block including the 🏝️ emoji, server name, and settings gear.

### Settings gear relocation

The settings gear (⚙️) currently lives in the header. After removing the header, it needs a new home. Options:

- **Option A:** Move settings gear to the bottom of the sidebar (common pattern in Discord, Slack)
- **Option B:** Move settings gear next to the "Channels" category header
- **Option C:** Remove it entirely — settings accessible via other means

**Recommendation:** Option A — bottom of sidebar, small icon row.

## Scope

- Remove header block from `Sidebar.tsx`
- Remove `header` and `title` from styles object
- Relocate settings gear
- Clean up related state if no longer needed (`serverSettingsOpen`, `closeServerSettings`)

## Questions

❓ Where should the settings gear go after removing the header?
❓ Should we keep the 🏝️ branding somewhere else?
