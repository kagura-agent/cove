# Spec: URL-based Channel Routing (#428)

## Problem

The browser URL never changes when navigating between guilds, channels, or threads. This prevents deep linking, browser back/forward navigation, bookmarking, and multi-tab usage.

## Discord Reference

```
/channels/{guildId}/{channelId}                    — channel view
/channels/{guildId}/{channelId}/threads/{threadId} — thread view
/channels/@me/{dmChannelId}                        — DM (future)
```

## Current State

- No router library installed
- Navigation state lives in zustand stores (`useGuildStore.activeGuildId`, `useChannelStore.activeChannelId`, `useThreadStore.activeThread`)
- URL is always `/` (except during OAuth callback with query params)
- SPA fallback already configured in Caddy: `try_files {path} /index.html` — no server changes needed

## Design

### URL Structure (Discord-aligned)

```
/channels/{guildId}/{channelId}                    — channel view
/channels/{guildId}/{channelId}/threads/{threadId} — thread open (side panel)
/                                                   — redirect to last active guild/channel
```

### Approach: react-router-dom v6

Use `react-router-dom` (v6+) with `createBrowserRouter`. Standard library, well maintained, handles:
- Nested routes
- URL params extraction (`useParams`)
- Navigation (`useNavigate`, `<Link>`)
- Popstate / back-forward automatically
- Loader/redirect patterns
- Future extensibility (settings pages, invite links, DMs, etc.)

### Route Definitions

```typescript
const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <RedirectToDefault /> },
      {
        path: "channels/:guildId/:channelId",
        element: <ChannelView />,
        children: [
          {
            path: "threads/:threadId",
            element: <ThreadSidePanel />,  // renders in a slot, NOT replacing parent
          },
        ],
      },
    ],
  },
]);
```

### Thread Routing: Side Panel (not Outlet replacement)

Current behavior: thread opens as a resizable side panel alongside the channel. This must be preserved.

The `/threads/:threadId` nested route does **not** use a standard `<Outlet />` that replaces the channel content. Instead:
- `ChannelView` always renders the message list
- `ChannelView` checks for a `threadId` param (via `useParams()`) and conditionally renders `<ThreadPanel />` as a side panel
- Closing the thread panel navigates back to `/channels/{guildId}/{channelId}` (removes `/threads/...` from URL)

```typescript
// Inside ChannelView
function ChannelView() {
  const { guildId, channelId, threadId } = useParams();
  // ... render message list always ...
  return (
    <>
      <MessageList channelId={channelId} />
      {threadId && <ThreadPanel threadId={threadId} />}
    </>
  );
}
```

### Store Migration Strategy

**Dual-source phase (this PR):**
- Keep `activeChannelId` and `activeGuildId` in stores but make them **derived from URL**
- Add a `useActiveChannel()` hook that reads from `useParams()` — all components migrate to this
- Store setters (`setActiveChannel`, `setActiveGuild`) become wrappers around `navigate()`
- Non-component code (e.g. `gateway-subscriptions.ts`) reads from a **sync store field** that the router updates via a `<RouterSync />` component

```typescript
// RouterSync component — bridges URL → store for non-component consumers
function RouterSync() {
  const { guildId, channelId } = useParams();
  const setActiveGuild = useGuildStore((s) => s.setActiveGuild);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);
  
  useEffect(() => {
    if (guildId) setActiveGuild(guildId);
    if (channelId) setActiveChannel(channelId);
  }, [guildId, channelId]);
  
  return null;
}
```

This means:
- **URL is source of truth** for navigation
- **Store fields stay** (for gateway-subscriptions, unread tracking, etc.) but are kept in sync by `RouterSync`
- Components prefer `useParams()` directly; non-React code reads store as before
- No big-bang migration — existing store reads continue to work

### READY Event vs Deep Link Race Condition

Current behavior: `gateway-subscriptions.ts` READY handler auto-selects the first channel if `activeChannelId` is null.

**Solution:** The READY handler must respect URL intent.

```typescript
// In gateway-subscriptions.ts READY handler
subscribe("READY", (data) => {
  // ... set guilds, channels ...
  
  // Only auto-select if NO channel is already active (i.e., URL didn't set one)
  if (!channelStore.activeChannelId) {
    // URL-based init hasn't fired yet OR user landed on "/"
    channelStore.setActiveChannel(activeGuildChannels[0].id);
  }
});
```

Load sequence:
1. App mounts → `createBrowserRouter` parses URL
2. `RouterSync` fires → sets `activeChannelId` in store from URL params
3. WS connects → READY arrives → sees `activeChannelId` already set → skips auto-select
4. If URL was just `/` → `activeChannelId` is null → READY auto-selects → `RedirectToDefault` navigates to the selected channel

Edge case: READY arrives before RouterSync effect fires (unlikely but possible in fast WS reconnect). Mitigation: the READY handler checks `window.location.pathname` directly as a fallback:

```typescript
if (!channelStore.activeChannelId) {
  const urlMatch = window.location.pathname.match(/^\/channels\/[^/]+\/([^/]+)/);
  if (!urlMatch) {
    // Truly no channel selected — auto-select
    channelStore.setActiveChannel(activeGuildChannels[0].id);
  }
  // else: URL has a channel, RouterSync will handle it
}
```

### OAuth Callback Flow

Current: `/?code=xxx` → exchange token → `window.history.replaceState({}, "", "/")` → reload.

Updated:
1. Before redirecting to Google OAuth, save current path in `sessionStorage`
2. After callback success, redirect to saved path (or `/` if none)
3. `RedirectToDefault` handles `/` → navigates to first guild/channel

```typescript
// Before OAuth redirect
sessionStorage.setItem("cove_return_path", window.location.pathname);

// After callback success  
const returnPath = sessionStorage.getItem("cove_return_path") || "/";
sessionStorage.removeItem("cove_return_path");
window.history.replaceState({}, "", returnPath);
```

### SPA Fallback (Server-side)

**Already handled.** Caddy config for staging:
```
handle {
  root * /var/www/cove-staging
  file_server
  try_files {path} /index.html
}
```

All non-API, non-gateway paths fall through to `index.html`. No server code changes needed.

### Edge Cases

| Case | Behavior |
|------|----------|
| Invalid guild/channel in URL | `ChannelView` detects invalid params → navigate to `/` |
| User not authenticated | Show login, after auth redirect to saved path |
| Channel deleted while URL points to it | Gateway CHANNEL_DELETE event → navigate to next channel |
| Root `/` with no prior state | `RedirectToDefault` → first guild's first channel |
| Thread closed/not found | Stay on channel view, drop `/threads/...` from URL |
| Multi-tab same user | Each tab has independent URL state, stores sync via WS events |
| `history.replaceState` vs `pushState` | Channel switches = push (back button works); store-sync corrections = replace (no history spam) |

## Acceptance Criteria

1. `react-router-dom` v6 installed and configured with `createBrowserRouter`
2. Switching channels updates URL to `/channels/{guildId}/{channelId}`
3. Opening a thread updates URL to `/channels/{guildId}/{channelId}/threads/{threadId}`
4. Pasting a channel/thread URL in a new tab opens that view directly (after auth)
5. Browser back/forward navigates between previously visited channels/threads
6. Invalid URLs gracefully redirect to default channel
7. READY event does not override URL-specified channel
8. OAuth flow preserves and restores the original URL
9. `gateway-subscriptions.ts` and other non-component code continues to work via synced store fields
10. Thread renders as side panel (not outlet replacement)
11. Existing Caddy SPA fallback works — no server changes needed

## Test Plan

- Unit: route matching, `RouterSync` store updates, READY handler respects existing activeChannelId, `useActiveChannel` hook
- Integration: navigate → verify URL; load URL → verify correct view renders; READY event → no override
- Manual: back/forward, copy-paste URL in new tab, thread deep link, OAuth redirect round-trip, multi-tab independence
