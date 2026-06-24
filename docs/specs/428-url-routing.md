# Spec: URL-based Channel Routing (#428)

## Problem

The browser URL never changes when navigating between guilds, channels, or threads. This prevents deep linking, browser back/forward navigation, bookmarking, and multi-tab usage.

## Discord Reference

```
/channels/{guildId}/{channelId}                    — channel view
/channels/{guildId}/{channelId}/threads/{threadId} — thread view (side panel)
/channels/@me/{dmChannelId}                        — DM (future)
```

## Current State

- No router library installed
- Navigation state in zustand: `useGuildStore.activeGuildId`, `useChannelStore.activeChannelId`, `useThreadStore.activeThread`
- URL is always `/`
- SPA fallback already configured in Caddy (`try_files {path} /index.html`)

## Design Principles

1. **URL is the single source of truth for navigation** (React Router official recommendation)
2. **Store holds entity data, not "what's selected"** — channels list, messages, members stay in store; which channel is active comes from URL
3. **Discord alignment** — same URL structure, same mental model

## URL Structure

```
/channels/{guildId}/{channelId}                    — channel view
/channels/{guildId}/{channelId}/threads/{threadId} — thread side panel
/                                                   — redirect to default
```

## Technology

**react-router-dom v6** with `createBrowserRouter` + `RouterProvider`.

## Route Definitions

```typescript
import { createBrowserRouter, RouterProvider } from "react-router-dom";

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
            element: <ThreadSidePanel />,
          },
        ],
      },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}
```

## Store Cleanup: Remove Navigation State

### What gets removed from stores

```typescript
// useGuildStore — DELETE these:
activeGuildId: string | null;
setActiveGuild: (id: string | null) => void;

// useChannelStore — DELETE these:
activeChannelId: string | null;
setActiveChannel: (id: string | null) => void;

// useThreadStore — DELETE these (if applicable):
activeThread: Thread | null;
setActiveThread: (thread: Thread | null) => void;
```

### What stays in stores

- `useChannelStore`: channels list, `getChannels()`, `addChannel()`, `removeChannel()`, `channelsLoaded`
- `useGuildStore`: guilds list, `setGuilds()`
- `useThreadStore`: thread data/messages (entity data, not selection)
- All message stores, member stores, etc. — unchanged

### New hook: `useActiveChannel()`

```typescript
// packages/client/src/hooks/useActiveChannel.ts
import { useParams } from "react-router-dom";

export function useActiveIds() {
  const { guildId, channelId, threadId } = useParams();
  return { guildId: guildId ?? null, channelId: channelId ?? null, threadId: threadId ?? null };
}
```

Components migrate from:
```typescript
// Before
const { activeChannelId } = useChannelStore();
// After
const { channelId } = useActiveIds();
```

### Non-React code: router.state subscription

`gateway-subscriptions.ts` and similar non-component code cannot use hooks. Solution: subscribe to the router instance directly.

```typescript
// packages/client/src/lib/router.ts
// Export router instance so non-React code can access current location

import { createBrowserRouter } from "react-router-dom";
export const router = createBrowserRouter([/* routes */]);

// Helper for non-React consumers
export function getActiveIdsFromRouter(): { guildId: string | null; channelId: string | null } {
  const match = router.state.location.pathname.match(
    /^\/channels\/([^/]+)\/([^/]+)/
  );
  if (!match) return { guildId: null, channelId: null };
  return { guildId: match[1], channelId: match[2] };
}

// Subscribe to route changes (for side-effect code like gateway-subscriptions)
export function subscribeToRoute(callback: () => void) {
  return router.subscribe(callback);
}
```

Usage in `gateway-subscriptions.ts`:
```typescript
import { getActiveIdsFromRouter } from "./router";

// Where it used to read useChannelStore.getState().activeChannelId:
const { channelId: activeChannelId } = getActiveIdsFromRouter();
```

### Navigation: use `navigate()` or `router.navigate()`

```typescript
// In components (hook)
const navigate = useNavigate();
navigate(`/channels/${guildId}/${channelId}`);

// In non-React code
import { router } from "./router";
router.navigate(`/channels/${guildId}/${channelId}`);
```

## Thread Routing: Side Panel

Thread opens as a resizable side panel alongside the channel (current behavior preserved).

`ChannelView` reads `threadId` from params and conditionally renders the panel:

```typescript
function ChannelView() {
  const { guildId, channelId, threadId } = useParams();
  const navigate = useNavigate();
  
  const closeThread = () => navigate(`/channels/${guildId}/${channelId}`);
  
  return (
    <div className="flex flex-1">
      <MessageList channelId={channelId!} />
      {threadId && (
        <ThreadPanel threadId={threadId} onClose={closeThread} />
      )}
      {/* Outlet NOT used — thread is a conditional side panel */}
    </div>
  );
}
```

## READY Event: Respect URL Intent

The READY handler in `gateway-subscriptions.ts` currently auto-selects the first channel. After migration:

```typescript
subscribe("READY", (data) => {
  // ... set guilds, channels data in stores ...
  
  // Only auto-navigate if user is on "/" (no channel in URL)
  const { channelId } = getActiveIdsFromRouter();
  if (!channelId && activeGuildChannels.length > 0) {
    router.navigate(`/channels/${guilds[0].id}/${activeGuildChannels[0].id}`, { replace: true });
  }
});
```

Load sequence:
1. App mounts → router parses URL → renders matching route
2. WS connects → READY arrives with guild/channel data
3. READY checks URL — if already on `/channels/x/y`, does nothing (data loads into stores, view already correct)
4. If on `/`, READY navigates to first guild/channel with `replace: true` (no back-button entry for the redirect)

## OAuth Callback Flow

```typescript
// Before redirecting to Google OAuth
sessionStorage.setItem("cove_return_path", window.location.pathname);

// After successful callback
const returnPath = sessionStorage.getItem("cove_return_path") || "/";
sessionStorage.removeItem("cove_return_path");
router.navigate(returnPath, { replace: true });
```

## SPA Fallback

Already handled by Caddy:
```
handle {
  root * /var/www/cove-staging
  file_server
  try_files {path} /index.html
}
```

No server code changes needed.

## Edge Cases

| Case | Behavior |
|------|----------|
| Invalid guild/channel in URL | Route renders → detects invalid → `navigate("/", { replace: true })` |
| User not authenticated | Show login → preserve URL → after auth, navigate to saved path |
| Channel deleted (WS event) | If viewing that channel → navigate to next available |
| Root `/` | `RedirectToDefault` → navigate to first guild/channel |
| Thread not found | Stay on channel, drop `/threads/...` |
| Multi-tab | Independent URL state per tab, entity stores sync via WS |
| replace vs push | Channel switch = push; auto-redirects/corrections = replace |

## Migration Scope

Files that need changes:
- `App.tsx` — wrap in RouterProvider, remove store-based activeChannelId usage
- `useChannelStore.ts` — remove `activeChannelId`, `setActiveChannel`
- `useGuildStore.ts` — remove `activeGuildId`, `setActiveGuild`
- `useThreadStore.ts` — remove `activeThread` selection state (keep thread data)
- `gateway-subscriptions.ts` — use `getActiveIdsFromRouter()` instead of store reads
- All components reading `activeChannelId` from store → use `useParams()` / `useActiveIds()`
- New: `src/lib/router.ts` — router instance + helpers
- New: `src/hooks/useActiveIds.ts` — convenience hook

## Acceptance Criteria

1. `react-router-dom` v6 with `createBrowserRouter` + `RouterProvider`
2. **No navigation state in zustand** — `activeChannelId`, `activeGuildId` removed
3. Switching channels updates URL to `/channels/{guildId}/{channelId}`
4. Opening a thread appends `/threads/{threadId}` to URL
5. Deep link (paste URL in new tab) opens correct channel/thread after auth
6. Browser back/forward works
7. Invalid URLs redirect to default
8. READY event respects URL — no override
9. OAuth preserves and restores original URL
10. Thread renders as side panel (not page replacement)
11. Non-React code works via `router.state` / `getActiveIdsFromRouter()`

## Test Plan

- Unit: `getActiveIdsFromRouter()` parsing, `RedirectToDefault` logic, READY handler with/without URL
- Integration: navigate → URL correct; load URL → correct view; channel delete → redirect
- Manual: back/forward, deep link in new tab, thread URL, OAuth round-trip, multi-tab
