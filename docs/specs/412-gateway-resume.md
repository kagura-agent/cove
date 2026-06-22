# Spec: Gateway RESUME — replay missed events on reconnect

**Issue:** #412
**Status:** Draft (R2 — addressing R1 blockers)

## Problem

When the Cove server restarts (e.g. CI deploy), all WebSocket connections drop. Clients reconnect within seconds, but events dispatched during the gap are lost. The client already sends `op: 6 RESUME` with `{token, session_id, seq}` on reconnect, but the server has no handler for it.

### Scope clarification

**Target scenario:** Brief network interruptions or client-side reconnects where the server stays up. During a full server restart, all in-memory state (including zombie sessions) is lost — the client will get INVALID_SESSION and do a fresh IDENTIFY. This matches Discord's behavior.

The deploy-induced message loss (#412's original trigger) is only solved when the deploy is a graceful rolling restart or when the disconnect is brief enough that the server is still running. For single-node deploys with full process restart, RESUME doesn't help — that requires a separate solution (e.g. client-side message backfill on IDENTIFY). This spec focuses on the RESUME mechanism itself.

## How Discord Does It

1. Client connects → HELLO → IDENTIFY → READY with `session_id`
2. Every DISPATCH carries incrementing sequence number `s`
3. Client disconnects (network blip, etc.)
4. Client reconnects → HELLO → sends `op: 6 RESUME` with `{token, session_id, seq}`
5. Server replays buffered events with `s > client_seq`, then sends RESUMED
6. If session expired or buffer exhausted → `op: 9 INVALID_SESSION` → client does fresh IDENTIFY

## Current State

| Component | Status |
|-----------|--------|
| Client sends RESUME on reconnect | ✅ Already implemented |
| Client handles RESUMED / INVALID_SESSION | ✅ Already implemented |
| Server RESUME handler | ❌ Missing |
| Server event buffer | ❌ Missing |
| Server session persistence after disconnect | ❌ Missing |

## Design: Separate Session from Socket

R1 review identified the core design issue: GatewaySession tightly couples logical session state with the WebSocket connection. The fix is to separate them.

### GatewaySession becomes the long-lived logical session

```typescript
class GatewaySession {
  readonly id: string;               // stable across reconnects
  private seq = 0;
  private ws: WebSocket | null;      // nullable — null when disconnected
  identified = false;
  user: UserInfo | null = null;
  readonly guildIds: Set<string> = new Set();

  // Event buffer — ring buffer of recent dispatches
  private eventBuffer: Array<{ seq: number; event: string; data: unknown }> = [];
  private static MAX_BUFFER_SIZE = 500;

  // Zombie state
  private zombieTimer: ReturnType<typeof setTimeout> | null = null;
  static ZOMBIE_TTL_MS = 60_000;
}
```

### dispatch() buffers even when disconnected

```typescript
dispatch(eventName: string, data: unknown): void {
  if (!this.identified) return;
  this.seq++;
  const entry = { seq: this.seq, event: eventName, data };

  // Always buffer (even when socket is disconnected)
  this.eventBuffer.push(entry);
  if (this.eventBuffer.length > GatewaySession.MAX_BUFFER_SIZE) {
    this.eventBuffer.shift();
  }

  // Only send if socket is connected
  if (this.ws?.readyState === WebSocket.OPEN) {
    this.ws.send(JSON.stringify({
      op: GatewayOpcode.DISPATCH,
      s: entry.seq,
      t: eventName,
      d: data,
    }));
  }
}
```

Key change: the session stays in the dispatcher's broadcast loop while zombied. Events are buffered but not sent over the wire. When the client resumes, missed events are replayed.

### Socket lifecycle methods

```typescript
/** Called when WebSocket disconnects. Session enters zombie state. */
detachSocket(): void {
  this.ws = null;
  this.zombieTimer = setTimeout(() => {
    this.zombieExpired = true;
  }, GatewaySession.ZOMBIE_TTL_MS);
}

/** Called on RESUME. Attach new socket to existing session. */
attachSocket(ws: WebSocket): void {
  if (this.zombieTimer) {
    clearTimeout(this.zombieTimer);
    this.zombieTimer = null;
  }
  this.ws = ws;
  this.zombieExpired = false;
}

/** Replay missed events since client's last sequence. */
replayEventsSince(seq: number): number {
  const missed = this.eventBuffer.filter(e => e.seq > seq);
  for (const entry of missed) {
    this.ws?.send(JSON.stringify({
      op: GatewayOpcode.DISPATCH,
      s: entry.seq,
      t: entry.event,
      d: entry.data,
    }));
  }
  return missed.length;
}

get currentSeq(): number {
  return this.seq;
}

get isZombie(): boolean {
  return this.identified && this.ws === null;
}
```

### ws/index.ts changes

**On disconnect:**
```typescript
ws.on("close", () => {
  if (heartbeatCheck) clearInterval(heartbeatCheck);
  if (expiryTimer) clearTimeout(expiryTimer);
  // Don't remove from dispatcher — enter zombie state
  session.detachSocket();
  // Session stays in dispatcher.sessions so it continues receiving buffered events
});
```

**RESUME handler:**
```typescript
case GatewayOpcode.RESUME: {
  const data = payload.d as { token?: string; session_id?: string; seq?: number } | null;
  if (!data?.token || !data?.session_id || data?.seq == null) {
    session.send({ op: GatewayOpcode.INVALID_SESSION, d: false, s: null, t: null });
    return;
  }

  // Authenticate
  const row = users.findByToken(data.token);
  if (!row) {
    session.close(4004, "Authentication failed");
    return;
  }

  // Check token expiry for non-bot users
  if (!row.bot && row.expires_at && row.expires_at < Date.now()) {
    session.close(4004, "Authentication expired");
    return;
  }

  // Find zombie session by session_id
  const zombie = dispatcher.findZombieSession(data.session_id);
  if (!zombie || zombie.user?.id !== row.id || zombie.zombieExpired) {
    session.send({ op: GatewayOpcode.INVALID_SESSION, d: false, s: null, t: null });
    // Clean up expired zombie
    if (zombie?.zombieExpired) dispatcher.removeSession(zombie);
    return;
  }

  // Check buffer can satisfy the request
  const oldestBuffered = zombie.oldestBufferedSeq;
  if (oldestBuffered !== null && data.seq < oldestBuffered) {
    // Client missed more events than buffer holds — can't replay
    session.send({ op: GatewayOpcode.INVALID_SESSION, d: false, s: null, t: null });
    dispatcher.removeSession(zombie);
    return;
  }

  // Attach new socket to existing session
  // Remove the empty "new" session that was created for this connection
  dispatcher.removeSession(session);

  // Reattach zombie with new socket
  zombie.attachSocket(ws);
  const replayed = zombie.replayEventsSince(data.seq);

  // Send RESUMED
  zombie.dispatch("RESUMED", null);

  // Restart heartbeat/expiry for the resumed session
  // (reuse existing heartbeat/expiry setup)
  
  log?.info?.(`Gateway RESUME: session ${data.session_id} resumed, replayed ${replayed} events`);
  break;
}
```

**Dispatcher changes:**
```typescript
// New method on GatewayDispatcher
findZombieSession(sessionId: string): GatewaySession | null {
  return this.sessionsById.get(sessionId) ?? null;
  // Zombie sessions remain in sessionsById — they have isZombie = true
}
```

### Presence handling

When a session becomes zombie:
- Do NOT broadcast PRESENCE_UPDATE offline immediately
- Wait until zombie TTL expires, then broadcast offline
- On RESUME: no presence change needed (user was never "offline" from other users' perspective)
- On zombie expiry: broadcast offline + remove session

## Edge Cases

| Case | Behavior |
|------|----------|
| Brief disconnect (<60s) | RESUME succeeds, missed events replayed |
| Long disconnect (>60s) | Zombie expired → INVALID_SESSION → fresh IDENTIFY |
| Full server restart | All in-memory state lost → INVALID_SESSION → fresh IDENTIFY |
| Buffer overflow (500+ events missed) | Oldest seq check fails → INVALID_SESSION |
| Wrong token on RESUME | Close 4004 |
| Token expired | Close 4004 |
| Multiple rapid reconnects | Each detach/attach cycle is clean |
| DoS via zombie accumulation | Zombies auto-expire after 60s; bounded by max concurrent sessions |

## Scope

Files changed:
- `packages/server/src/ws/session.ts` — separate socket from session, event buffer, zombie lifecycle
- `packages/server/src/ws/index.ts` — RESUME handler, modified close handler, no immediate presence offline
- `packages/server/src/ws/dispatcher.ts` — findZombieSession, deferred presence offline

Files unchanged:
- `packages/shared/` — opcodes already defined
- Plugin (client) — already fully implements RESUME

## Verification

1. Bot connects → note session_id
2. Kill bot's WebSocket (without stopping server)
3. Bot reconnects → sends RESUME → receives RESUMED + replayed events
4. Send a message to a channel during the disconnect gap → verify bot receives it after RESUME
5. Wait > 60s → RESUME gets INVALID_SESSION → bot does fresh IDENTIFY
6. Verify presence doesn't flicker offline/online on brief reconnects
7. Run full test suite — existing WS tests should still pass
