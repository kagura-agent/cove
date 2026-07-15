# Spec: Cross-channel Messaging API (#451)

> First-class API for bots to send messages to any channel they have SEND_MESSAGES permission on, without manually managing webhooks.

## Problem

Cross-channel messaging currently requires: create webhook → store token → call execute endpoint. This is tedious, error-prone, and leaks implementation details (webhooks) into what should be a simple "send message to channel" operation.

## Design Principle

**Webhook is an implementation detail, not a user-facing concept for cross-channel messaging.** Users see a simple send API; the platform handles message routing internally.

---

## 1. User-Facing API

### 1.1 Incoming Endpoint

```
POST /api/channels/:channelId/incoming
Authorization: Bot <token>
Content-Type: application/json

{
  "content": "hello from another channel",
  "username": "Kagura",        // optional, display name override
  "avatar_url": "https://...", // optional, avatar override
  "embeds": []                  // optional, same as webhook execute
}
```

**Permission:** `SEND_MESSAGES` on target channel.

**Response:** Standard message object (same as webhook execute response).

**Rate limit:** Uses the internal webhook's own rate limit bucket (independent from user-created webhooks).

### 1.2 Behavior

- Message is created with a `webhook_id` — bots will **not** echo-ignore it and will respond normally
- Supports all fields that webhook execute supports: `content`, `username`, `avatar_url`, `embeds`, `thread_id`
- Thread support: optional `thread_id` in body to post into a thread

---

## 2. Internal Mechanism

### 2.1 Internal Webhook (type=2)

Each channel has an auto-provisioned **internal webhook** (type=2). This is purely an implementation detail — never exposed to users.

- **Created automatically** when a channel is created
- **Backfilled** for existing channels via migration
- **Not visible** in any user-facing API or UI
- **Not deletable/editable** via webhook management API
- Name: `internal` (arbitrary, never shown to users)

### 2.2 Incoming Flow

```
Client → POST /channels/:id/incoming
  → Server validates SEND_MESSAGES permission
  → Server looks up internal webhook for channel
    → If missing (edge case): auto-create it (lazy recovery)
  → Server calls existing webhook execute logic
  → Message created with webhook_id set
  → Response returned to client
```

---

## 3. Implementation Steps

### 3.1 DB Migration (v9)

- Add column: `webhooks.type INTEGER NOT NULL DEFAULT 1`
  - type=1: user-created webhook (existing behavior)
  - type=2: internal webhook (platform-managed)
- Backfill: application-level loop over existing channels, calling `repos.webhooks.create()` for each (needs crypto-random token generation, can't be pure SQL)
- Migration runs once at startup, idempotent (skip channels that already have type=2 webhook)

### 3.2 Channel Creation (channels.ts)

- After successful `POST /guilds/:guildId/channels`, auto-create a type=2 webhook:
  ```
  repos.webhooks.create(channelId, guildId, 'internal', null, 2)
  ```

### 3.3 Webhook Protection (webhooks.ts)

- `DELETE /webhooks/:id` → if type=2, return 403 `{ message: 'Cannot delete internal webhook', code: 50013 }`
- `PATCH /webhooks/:id` → if type=2, return 403

### 3.4 Webhook Visibility

- `GET /channels/:channelId/webhooks` (listByChannel) → filter `WHERE type = 1` by default
- UI webhook management → only shows user-created webhooks
- Internal webhooks are invisible to all external consumers

### 3.5 Incoming Route (new file: routes/incoming.ts)

```typescript
POST /channels/:channelId/incoming
  - Validate bot auth
  - Check SEND_MESSAGES permission on target channel
  - Find internal webhook: repos.webhooks.findInternal(channelId)
    - If not found: auto-create (lazy recovery), then proceed
  - Execute webhook with provided body (content, username, avatar_url, embeds, thread_id)
  - Return message object
```

### 3.6 WebhooksRepo Changes

- `create()` — add `type` parameter (default 1)
- `findInternal(channelId)` — new method, returns type=2 webhook for channel
- `listByChannel()` — add `WHERE type = 1` filter

### 3.7 Shared Types

```typescript
// Webhook interface
interface Webhook {
  // ... existing fields
  type: number;  // 1 = user, 2 = internal
}

// Incoming request (same fields as webhook execute)
interface IncomingRequest {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: Embed[];
  thread_id?: string;
}
```

---

## 4. Design Decisions

| Decision | Status | Rationale |
|----------|--------|-----------|
| Permission = SEND_MESSAGES | ✅ | Cross-post = sending a message. Same permission as normal message send. |
| Internal webhook hidden from all APIs | ✅ | Implementation detail, not user concept |
| Reuse webhook execute logic | ✅ | No duplication of message creation, rate limit, thread support |
| Endpoint name: `incoming` | ✅ | Clear intent, no conflict with Discord's `crosspost` (announcement repost) |
| Internal webhook name: `internal` | ✅ | Never shown to users, just a DB value |

---

## 5. What We're NOT Doing

- Not exposing internal webhook tokens to anyone
- Not adding a query endpoint for internal webhooks
- Not changing webhook execute logic
- Not changing client UI
- Not adding new permission types

---

## 6. Acceptance Criteria

- [ ] `POST /channels/:id/incoming` sends a message successfully
- [ ] Message has `webhook_id` set — bots respond to it
- [ ] `username`, `avatar_url`, and `embeds` all work
- [ ] Without SEND_MESSAGES → 403
- [ ] New channels auto-get internal webhook
- [ ] Migration backfills existing channels
- [ ] Internal webhooks don't appear in `GET /channels/:id/webhooks`
- [ ] Internal webhooks cannot be deleted or edited via API
- [ ] Existing tests pass unchanged

---

## 7. Future Considerations (out of scope)

- Client UI for cross-channel send (e.g. "share to channel" button)
- File/attachment upload support (binary multipart)
- Audit log entries for incoming actions
