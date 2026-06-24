# Spec: URL-based Channel Routing (#428)

## Problem

The browser URL never changes when navigating between guilds, channels, or threads. This prevents deep linking, browser back/forward navigation, bookmarking, and multi-tab usage.

## Discord Reference

Discord URL structure: `/channels/{guildId}/{channelId}`
Thread/DM variations: `/channels/@me/{dmChannelId}`

## Current State

- No router library installed
- Navigation state lives in zustand stores (`useGuildStore.activeGuildId`, `useChannelStore.activeChannelId`)
- URL is always `/` (except during OAuth callback with query params)
- `window.history.replaceState({}, "", "/")` is called after OAuth to clean up

## Design

### URL Structure

```
/channels/{guildId}/{channelId}        — channel view
/channels/{guildId}/{channelId}/{threadId} — thread open (optional, stretch)
/                                       — redirect to last active or first guild/channel
```

### Approach: Lightweight `history.pushState` (no router library)

Since the app is a single-page shell with one main view (guild → channel → messages), a full router library is overkill. Instead:

1. **URL → State (on load):** Parse `window.location.pathname` on app init. If it matches `/channels/{guildId}/{channelId}`, set the corresponding store state after channels load.

2. **State → URL (on navigate):** When `setActiveGuild` or `setActiveChannel` is called, push a new history entry via `window.history.pushState`.

3. **Popstate (back/forward):** Listen to `window.onpopstate`, parse the URL, and update store state accordingly.

### Implementation Outline

Create a `useUrlSync` hook (or similar) that:

```typescript
// packages/client/src/hooks/useUrlSync.ts

export function useUrlSync() {
  const { activeGuildId } = useGuildStore();
  const { activeChannelId, channelsLoaded } = useChannelStore();

  // On mount: parse URL → set state (if valid guild/channel)
  useEffect(() => {
    const match = window.location.pathname.match(
      /^\/channels\/([^/]+)\/([^/]+)/
    );
    if (match) {
      const [, guildId, channelId] = match;
      // validate and set store state
    }
  }, [channelsLoaded]);

  // On state change: push URL
  useEffect(() => {
    if (activeGuildId && activeChannelId) {
      const path = `/channels/${activeGuildId}/${activeChannelId}`;
      if (window.location.pathname !== path) {
        window.history.pushState(null, "", path);
      }
    }
  }, [activeGuildId, activeChannelId]);

  // Listen for popstate (back/forward)
  useEffect(() => {
    const handler = () => {
      const match = window.location.pathname.match(
        /^\/channels\/([^/]+)\/([^/]+)/
      );
      if (match) {
        // update stores without pushing another history entry
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
}
```

### Server-side: Catch-all Route

The server must serve `index.html` for any `/channels/*` path (SPA fallback). Check if the existing server config already handles this (likely via a catch-all for the Vite/static build).

### Edge Cases

| Case | Behavior |
|------|----------|
| Invalid guild/channel in URL | Redirect to `/`, fall back to default |
| User not authenticated | Show login, after auth redirect to original URL |
| Channel deleted while URL points to it | Clear URL, select next available |
| OAuth callback (`/?code=...`) | Existing flow unchanged, redirect to last channel after |
| Root `/` with no prior state | Select first guild's first channel |

### What This Does NOT Include

- Thread ID in URL (can be follow-up)
- Guild list routing (`/@me` for DMs)
- Full react-router migration
- URL for settings/modals

## Acceptance Criteria

1. Switching channels updates the browser URL to `/channels/{guildId}/{channelId}`
2. Pasting a channel URL in a new tab opens that channel directly (after auth)
3. Browser back/forward navigates between previously visited channels
4. Invalid URLs gracefully fall back to the default channel
5. No router library added — pure `history.pushState` + `popstate`
6. Server serves index.html for `/channels/*` paths (SPA fallback)

## Test Plan

- Unit: `useUrlSync` hook — mock pushState/popstate, verify state ↔ URL sync
- Manual: switch channels → verify URL changes; copy URL → new tab → verify correct channel loads; back/forward buttons work
