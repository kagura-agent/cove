# Spec: Hide ConnectionBanner when connected

**Issue:** #449
**Status:** Draft

## Problem

The page has a `ConnectionBanner` fixed at the very top of the viewport. When connected, it displays the server icon + server name (e.g. "Yueying Chen (Luna Chen)'s Server"). This wastes vertical space — the server name is not useful in Cove's single-server context.

## Current Implementation

`packages/client/src/AppShell.tsx`:

```tsx
<ConnectionBanner status={wsStatus} serverName={serverName} serverIcon={serverIcon} />
```

`packages/client/src/components/ConnectionBanner.tsx` renders three states:
- **connecting** → "Connecting..."
- **disconnected** → "Disconnected"
- **connected** → server icon + server name

## Proposal

**Hide the banner entirely when connected.** Keep it visible for connecting / disconnected states — connection status feedback is still useful.

Implementation: return `null` (or render nothing) when `status === "connected"`.

### What about the sidebar header?

The sidebar (`Sidebar.tsx`) also has a header row with 🏝️ + guild name + settings gear. That's a **separate element** and is out of scope for this issue. It can be addressed later if needed.

## Scope

- `ConnectionBanner.tsx`: return `null` when `status === "connected"`
- No other components affected
- Settings gear is unaffected (it lives in the sidebar header, not in this banner)

## Decision Log

- ✅ Connected state: hide banner completely (Luna: "点儿占位置")
- ✅ Connecting / disconnected: keep as-is
