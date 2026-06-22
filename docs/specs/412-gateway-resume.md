# Spec: Gateway RESUME — replay missed events on reconnect

**Issue:** #412
**Status:** Draft

## Problem

When the Cove server restarts (e.g. CI deploy), all WebSocket connections drop. Clients reconnect within seconds, but any events dispatched during the gap are lost. The client already sends `op: 6 RESUME` with `{token, session_id, seq}` on reconnect, but the server ignores it (no handler) and the client falls back to a fresh IDENTIFY after a 5s timeout.

## How Discord Does It

Discord's Gateway RESUME flow:

1. **Client connects** → receives HELLO → sends IDENTIFY → receives READY with `session_id`
2. **Every DISPATCH** carries an incrementing sequence number `s`
3. **Client disconnects** (network issue, server restart, etc.)
4. **Client reconnects** → receives HELLO → sends `op: 6 RESUME` with `{token, session_id, seq}` (last received sequence)
5. **Server looks up the session** by `session_id`:
   - **Found + valid:** replays all buffered events with `s > client_seq`, then sends `RESUMED` event
   - **Not found / expired:** sends `op: 9 INVALID_SESSION` with `d: false` → client does fresh IDENTIFY
6. **Replay is transparent** — client receives missed events as normal DISPATCH payloads

Key properties:
- Server buffers dispatched events per session (bounded — last N events or last T seconds)
- Session state survives disconnect for a grace period (Discord: ~30s–60s)
- RESUME is idempotent — replaying the same events is safe (client deduplicates by sequence)
- If buffer is exhausted (client was offline too long), server sends INVALID_SESSION

## Current State (Cove)

| Component | Status |
|-----------|--------|
| `GatewayOpcode.RESUME` (shared) | ✅ Defined (op: 6) |
| `GatewayOpcode.INVALID_SESSION` (shared) | ✅ Defined (op: 9) |
| Client sends RESUME on reconnect | ✅ Already implemented in plugin |
| Client handles RESUMED event | ✅ Already implemented in plugin |
| Client handles INVALID_SESSION | ✅ Already implemented (falls back to IDENTIFY) |
| Server handles RESUME opcode | ❌ Missing — falls through to `default: break` |
| Server event buffer | ❌ Missing — events dispatched and forgotten |
| Server session persistence after disconnect | ❌ Missing — session removed on ws close |

## Solution

### 1. Event buffer in GatewaySession

Add a ring buffer to each session that stores dispatched events:

```typescript
// session.ts
private eventBuffer: Array<{ seq: number; event: string; data: unknown }> = [];
private static MAX_BUFFER_SIZE = 500;

dispatch(eventName: string, data: unknown): void {
  if (!this.identified || this.ws.readyState !== WebSocket.OPEN) return;
  this.seq++;
  const entry = { seq: this.seq, event: eventName, data };
  this.eventBuffer.push(entry);
  if (this.eventBuffer.length > GatewaySession.MAX_BUFFER_SIZE) {
    this.eventBuffer.shift();
  }
  this.ws.send(JSON.stringify({
    op: GatewayOpcode.DISPATCH,
    s: this.seq,
    t: eventName,
    d: data,
  }));
}
```

### 2. Session persistence after disconnect

In `ws/index.ts`, instead of immediately removing the session on ws close, keep it in a "zombie" map with a TTL:

```typescript
// Zombie sessions: disconnected but resumable
const zombieSessions = new Map<string, { session: GatewaySession; timer: ReturnType<typeof setTimeout> }>();
const ZOMBIE_TTL_MS = 60_000; // 60s grace period

ws.on("close", () => {
  // Don't remove from dispatcher yet — move to zombie state
  dispatcher.removeSession(session);
  zombieSessions.set(session.id, {
    session,
    timer: setTimeout(() => {
      zombieSessions.delete(session.id);
    }, ZOMBIE_TTL_MS),
  });
});
```

### 3. RESUME handler in ws/index.ts

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

  // Find zombie session
  const zombie = zombieSessions.get(data.session_id);
  if (!zombie || zombie.session.user?.id !== row.id) {
    session.send({ op: GatewayOpcode.INVALID_SESSION, d: false, s: null, t: null });
    return;
  }

  // Restore state from zombie to new session
  clearTimeout(zombie.timer);
  zombieSessions.delete(data.session_id);

  // Replay missed events
  const missed = zombie.session.getEventsSince(data.seq);
  session.restoreFrom(zombie.session);
  dispatcher.addSession(session);

  for (const entry of missed) {
    session.replayEvent(entry);
  }

  session.send({
    op: GatewayOpcode.DISPATCH,
    s: session.currentSeq,
    t: "RESUMED",
    d: null,
  });
  break;
}
```

### 4. New methods on GatewaySession

```typescript
getEventsSince(seq: number): Array<{ seq: number; event: string; data: unknown }> {
  return this.eventBuffer.filter(e => e.seq > seq);
}

restoreFrom(old: GatewaySession): void {
  this.user = old.user;
  this.identified = true;
  this.seq = old.seq;
  this.eventBuffer = old.eventBuffer;
  for (const gid of old.guildIds) {
    this.guildIds.add(gid);
  }
}

replayEvent(entry: { seq: number; event: string; data: unknown }): void {
  this.ws.send(JSON.stringify({
    op: GatewayOpcode.DISPATCH,
    s: entry.seq,
    t: entry.event,
    d: entry.data,
  }));
}
```

## Scope

Files changed:
- `packages/server/src/ws/session.ts` — event buffer, getEventsSince, restoreFrom, replayEvent
- `packages/server/src/ws/index.ts` — RESUME handler, zombie session map, modified close handler

Files unchanged:
- `packages/shared/` — opcodes already defined
- Plugin (client) — already sends RESUME and handles RESUMED/INVALID_SESSION

## Edge Cases

- **Buffer exhausted** (client offline > buffer capacity) → INVALID_SESSION → fresh IDENTIFY
- **Session expired** (zombie TTL exceeded) → INVALID_SESSION → fresh IDENTIFY
- **Token mismatch** (different user tries to resume) → INVALID_SESSION
- **Multiple rapid reconnects** — each RESUME replaces the previous zombie cleanly
- **Server restart** — all zombie sessions lost (in-memory), client gets INVALID_SESSION → IDENTIFY. This is acceptable — matches Discord behavior where a full server restart loses resume state.

## Verification

1. Connect bot → note session_id and seq
2. Restart cove-staging service
3. Bot reconnects → sends RESUME → receives RESUMED + replayed events
4. Verify no MESSAGE_CREATE events are lost during the restart window
5. Wait > 60s after disconnect → RESUME should get INVALID_SESSION → fresh IDENTIFY
6. Test with wrong token → should get close 4004
