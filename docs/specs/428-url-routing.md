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
- Navigation state lives in zustand stores (`useGuildStore.activeGuildId`, `useChannelStore.activeChannelId`)
- URL is always `/` (except during OAuth callback with query params)

## Design

### URL Structure (Discord-aligned)

```
/channels/{guildId}/{channelId}                    — channel view
/channels/{guildId}/{channelId}/threads/{threadId} — thread open
/                                                   — redirect to last active guild/channel
```

### Approach: react-router

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
            element: <ThreadPanel />,
          },
        ],
      },
    ],
  },
]);
```

### Migration from Zustand State

Currently `activeGuildId` and `activeChannelId` in stores drive the UI. After migration:
- **URL becomes the source of truth** for which guild/channel/thread is displayed
- Stores still hold the data (channel list, messages, etc.) but active selection comes from route params
- `setActiveChannel(id)` calls become `navigate(`/channels/${guildId}/${channelId}`)` 
- Components read from `useParams()` instead of `useChannelStore().activeChannelId`

### Server-side: Catch-all Route

The server must serve `index.html` for any path that doesn't match an API route or static file (SPA fallback). Verify the existing Vite/Express config handles this.

### Edge Cases

| Case | Behavior |
|------|----------|
| Invalid guild/channel in URL | Redirect to `/`, fall back to default |
| User not authenticated | Show login, after auth redirect to original URL |
| Channel deleted while URL points to it | Redirect to next available channel |
| OAuth callback (`/?code=***`) | Existing flow, then redirect to last channel |
| Root `/` with no prior state | Select first guild's first channel |
| Thread closed/not found | Stay on channel, clear thread from URL |

## Acceptance Criteria

1. `react-router-dom` v6 installed and configured with `createBrowserRouter`
2. Switching channels updates URL to `/channels/{guildId}/{channelId}`
3. Opening a thread updates URL to `/channels/{guildId}/{channelId}/threads/{threadId}`
4. Pasting a channel/thread URL in a new tab opens that view directly (after auth)
5. Browser back/forward navigates between previously visited channels/threads
6. Invalid URLs gracefully redirect to default channel
7. Server serves index.html for all non-API paths (SPA fallback)
8. Existing OAuth flow still works

## Test Plan

- Unit: route matching, redirect logic, invalid URL handling
- Integration: navigate → verify URL; load URL → verify correct view renders
- Manual: back/forward, copy-paste URL in new tab, thread deep link, auth redirect
