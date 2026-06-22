# Spec: Gateway RESUME — replay missed events on reconnect

**Issue:** #412
**Status:** Draft (R3 — addressing R2 blockers)

## Problem

When a client briefly loses its WebSocket connection (network blip, mobile background, etc.), events dispatched during the gap are lost. The client already sends `op: 6 RESUME` with `{token, session_id, seq}` on reconnect, but the server has no handler for it.

**Scope:** This solves brief disconnections where the server stays up. Full server restarts lose all in-memory state — the client gets INVALID_SESSION and does a fresh IDENTIFY. This matches Discord's behavior.

## Current State

| Component | Status |
|-----------|--------|
| Client sends RESUME on reconnect | ✅ Already implemented |
| Client handles RESUMED / INVALID_SESSION | ✅ Already implemented |
| Server RESUME handler | ❌ Missing |
| Server event buffer | ❌ Missing |
| Server session persistence after disconnect | ❌ Missing |

## Design: Separate Session from Socket

GatewaySession becomes long-lived. The WebSocket is attached/detached as clients connect/disconnect.

### GatewaySession changes (session.ts)

```typescript
class GatewaySession {
  readonly id: string;
  private seq = 0;
  private _ws: WebSocket | null;
  private _identified = false;
  user: UserInfo | null = null;
  readonly guildIds: Set<string> = new Set();

  // Event buffer
  private eventBuffer: Array<{ seq: number; event: string; data: unknown }> = [];
  private static MAX_BUFFER_SIZE = 500;

  // Zombie state
  private _zombieExpired = false;
  private _zombieTimer: ReturnType<typeof setTimeout> | null = null;
  static ZOMBIE_TTL_MS = 60_000;

  constructor(ws: WebSocket) {
    this.id = generateSnowflake();
    this._ws = ws;
  }

  get isIdentified(): boolean { return this._identified; }
  get currentSeq(): number { return this.seq; }
  get isZombie(): boolean { return this._identified && this._ws === null; }
  get zombieExpired(): boolean { return this._zombieExpired; }
  get ws(): WebSocket | null { return this._ws; }

  get oldestBufferedSeq(): number | null {
    return this.eventBuffer.length > 0 ? this.eventBuffer[0].seq : null;
  }

  dispatch(eventName: string, data: unknown): void {
    if (!this._identified) return;
    this.seq++;
    const entry = { seq: this.seq, event: eventName, data };

    // Always buffer (even when disconnected)
    this.eventBuffer.push(entry);
    if (this.eventBuffer.length > GatewaySession.MAX_BUFFER_SIZE) {
      this.eventBuffer.shift();
    }

    // Only send if socket is connected
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({
        op: GatewayOpcode.DISPATCH,
        s: entry.seq,
        t: eventName,
        d: entry.data,
      }));
    }
  }

  send(payload: GatewayPayload): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(payload));
    }
  }

  /** Enter zombie state. Session stays in dispatcher for buffering. Idempotent. */
  detachSocket(onExpiry: () => void, tokenExpiresAt?: number): void {
    if (this.isZombie) return; // guard: already zombie (e.g. heartbeat timeout + close race)
    this._ws = null;
    this._zombieExpired = false;
    // Cap zombie TTL to token remaining time (for non-bot sessions)
    let ttl = GatewaySession.ZOMBIE_TTL_MS;
    if (tokenExpiresAt) {
      const tokenRemaining = tokenExpiresAt - Date.now();
      if (tokenRemaining <= 0) {
        this._zombieExpired = true;
        onExpiry();
        return;
      }
      ttl = Math.min(ttl, tokenRemaining);
    }
    this._zombieTimer = setTimeout(() => {
      this._zombieExpired = true;
      onExpiry(); // dispatcher handles cleanup
    }, ttl);
  }

  /** Resume: attach new socket to this session. */
  attachSocket(ws: WebSocket): void {
    if (this._zombieTimer) {
      clearTimeout(this._zombieTimer);
      this._zombieTimer = null;
    }
    this._ws = ws;
    this._zombieExpired = false;
  }

  /** Replay events the client missed. Returns count. */
  replayEventsSince(seq: number): number {
    const missed = this.eventBuffer.filter(e => e.seq > seq);
    for (const entry of missed) {
      if (this._ws?.readyState !== WebSocket.OPEN) break;
      this._ws.send(JSON.stringify({
        op: GatewayOpcode.DISPATCH,
        s: entry.seq,
        t: entry.event,
        d: entry.data,
      }));
    }
    return missed.length;
  }

  /** Cancel zombie timer without attaching a new socket (for full cleanup). */
  cancelZombieTimer(): void {
    if (this._zombieTimer) {
      clearTimeout(this._zombieTimer);
      this._zombieTimer = null;
    }
  }

  // identify() — unchanged, sets this._identified = true, populates guilds, sends READY

  close(code: number, reason: string): void {
    this._ws?.close(code, reason);
  }
}
```

### Dispatcher changes (dispatcher.ts)

```typescript
/** Find a zombie session by ID. Only returns zombie sessions. */
findZombieSession(sessionId: string): GatewaySession | null {
  const session = this.sessionsById.get(sessionId);
  if (!session || !session.isZombie) return null;
  return session;
}

/** Full cleanup: remove session, broadcast offline, release resources. */
reapZombieSession(session: GatewaySession): void {
  session.cancelZombieTimer();
  this.removeSession(session); // removes from sessions + sessionsById + userSessions
  // removeSession already broadcasts PRESENCE_UPDATE offline when last session for user
}

/** Schedule deferred offline for zombie. Don't broadcast immediately. */
// Note: removeSession is NOT called on disconnect anymore.
// Presence stays "online" while zombie is alive.
// Only goes "offline" when zombie expires or is explicitly reaped.
```

### ws/index.ts — Connection lifecycle

The core complexity is managing closures. Each WebSocket connection has its own heartbeat timer, expiry timer, and close handler. On RESUME, these must be properly set up for the resumed session.

**Key insight:** `lastHeartbeat` lives inside `setupConnectionHandlers` but the HEARTBEAT opcode is handled in the outer `ws.on('message')`. Solution: `setupConnectionHandlers` returns a `handleHeartbeat` callback that the message handler calls.

**Extract setup into a reusable function:**

```typescript
/** Returned handle allows outer message handler to interact with connection state. */
interface ConnectionHandle {
  handleHeartbeat(): void;
  cleanup(): void;
}

function setupConnectionHandlers(
  ws: WebSocket,
  session: GatewaySession,
  dispatcher: GatewayDispatcher,
  users: UsersRepo,
  opts: { sessionToken?: string; expiresAt?: number }
): ConnectionHandle {
  let lastHeartbeat = Date.now();

  const heartbeatCheck = setInterval(() => {
    if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
      clearInterval(heartbeatCheck);
      if (!session.isZombie) { // guard: avoid double-detach
        session.detachSocket(() => dispatcher.reapZombieSession(session), opts.expiresAt);
      }
      ws.close(4009, "Session timed out");
    }
  }, HEARTBEAT_INTERVAL);

  // Token expiry: zombie TTL = min(ZOMBIE_TTL, token remaining)
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  if (opts.sessionToken && opts.expiresAt) {
    const tokenTtl = opts.expiresAt - Date.now();
    if (tokenTtl > 0) {
      expiryTimer = scheduleExpiry(ws, session, users, opts.sessionToken, tokenTtl);
    }
  }

  // CLOSE handler
  ws.on("close", () => {
    clearInterval(heartbeatCheck);
    if (expiryTimer) clearTimeout(expiryTimer);
    if (!session.isZombie) { // guard: avoid double-detach from heartbeat timeout + close race
      session.detachSocket(() => dispatcher.reapZombieSession(session), opts.expiresAt);
    }
  });

  return {
    handleHeartbeat: () => { lastHeartbeat = Date.now(); },
    cleanup: () => {
      clearInterval(heartbeatCheck);
      if (expiryTimer) clearTimeout(expiryTimer);
    },
  };
}
```

**Pre-handshake watchdog** (15s timeout if client never sends IDENTIFY/RESUME):

```typescript
// Set immediately on connection, cleared once IDENTIFY/RESUME succeeds
const handshakeTimeout = setTimeout(() => {
  ws.close(4000, "Handshake timeout");
}, 15_000);
```

**IDENTIFY handler** (existing, slightly modified):
```typescript
case GatewayOpcode.IDENTIFY: {
  if (session.isIdentified) { session.close(4005, "Already identified"); return; }
  clearTimeout(handshakeTimeout);
  // ... authenticate as before ...
  session.identify(user, dispatcher, guilds, channels, readStates, permissions);
  dispatcher.addSession(session);
  connHandle = setupConnectionHandlers(ws, session, dispatcher, users, {
    sessionToken: identifyToken,
    expiresAt: user.expires_at,
  });
  break;
}
```

**RESUME handler** (new):
```typescript
case GatewayOpcode.RESUME: {
  // Guard: reject double-RESUME or RESUME-after-IDENTIFY
  if (connHandle || session.isIdentified) {
    sendInvalidSession(ws);
    return;
  }

  const data = payload.d as { token?: string; session_id?: string; seq?: number } | null;
  if (!data?.token || !data?.session_id || data?.seq == null) {
    sendInvalidSession(ws);
    return;
  }

  // Authenticate
  const row = users.findByToken(data.token);
  if (!row) {
    ws.close(4004, "Authentication failed");
    return;
  }

  // Token expiry check
  if (!row.bot && row.expires_at && row.expires_at < Date.now()) {
    ws.close(4004, "Authentication expired");
    return;
  }

  // Find zombie session
  const zombie = dispatcher.findZombieSession(data.session_id);
  if (!zombie || zombie.user?.id !== row.id || zombie.zombieExpired) {
    if (zombie?.zombieExpired) dispatcher.reapZombieSession(zombie);
    sendInvalidSession(ws);
    return;
  }

  // Buffer overflow check (off-by-one: oldest is the first buffered seq,
  // client needs seq > client_seq, so client_seq < oldest - 1 means gap)
  const oldest = zombie.oldestBufferedSeq;
  if (oldest !== null && data.seq < oldest - 1) {
    dispatcher.reapZombieSession(zombie);
    sendInvalidSession(ws);
    return;
  }

  clearTimeout(handshakeTimeout);

  // Attach new socket to zombie session
  // (preliminary session was never added to dispatcher, no removeSession needed)
  zombie.attachSocket(ws);

  // Replay missed events
  const replayed = zombie.replayEventsSince(data.seq);

  // Send RESUMED
  zombie.send({
    op: GatewayOpcode.DISPATCH,
    s: zombie.currentSeq,
    t: "RESUMED",
    d: null,
  });

  // Set up fresh connection handlers bound to the RESUMED session
  // This is critical — old closures pointed at the discarded `session`,
  // new closures must point at `zombie` (the real session)
  connHandle = setupConnectionHandlers(ws, zombie, dispatcher, users, {
    sessionToken: data.token,
    expiresAt: row.expires_at ?? undefined,
  });

  break;
}

function sendInvalidSession(ws: WebSocket): void {
  ws.send(JSON.stringify({
    op: GatewayOpcode.INVALID_SESSION,
    d: false,
    s: null,
    t: null,
  }));
}
```

**On connection** (modified):
```typescript
wss.on("connection", (ws, request) => {
  // Create a preliminary session — may be discarded if RESUME succeeds
  const session = new GatewaySession(ws);
  let connHandle: ConnectionHandle | null = null;

  // Pre-handshake watchdog: disconnect if no IDENTIFY/RESUME within 15s
  const handshakeTimeout = setTimeout(() => {
    ws.close(4000, "Handshake timeout");
  }, 15_000);

  // Send HELLO
  session.send({ op: GatewayOpcode.HELLO, d: { heartbeat_interval: HEARTBEAT_INTERVAL }, s: null, t: null });

  // Message handler
  ws.on("message", (raw) => {
    const payload = JSON.parse(raw.toString());
    switch (payload.op) {
      case GatewayOpcode.IDENTIFY: { /* ... sets connHandle ... */ break; }
      case GatewayOpcode.RESUME:  { /* ... sets connHandle ... */ break; }
      case GatewayOpcode.HEARTBEAT: {
        // Forward to connection handle (updates lastHeartbeat inside closure)
        if (connHandle) {
          connHandle.handleHeartbeat();
        }
        // Always ACK
        session.send({ op: GatewayOpcode.HEARTBEAT_ACK, d: null, s: null, t: null });
        break;
      }
    }
  });

  // If client disconnects before IDENTIFY/RESUME, clean up watchdog.
  // ws.on("close") for post-handshake is set up in setupConnectionHandlers.
  ws.on("close", () => {
    clearTimeout(handshakeTimeout);
    // If never identified, nothing to clean up (session never added to dispatcher)
  });
});
```

### Zombie limits

Cap total zombie sessions to prevent memory abuse:

```typescript
// In dispatcher
private static MAX_ZOMBIES = 100;

// In detachSocket flow: if zombie count exceeds limit,
// reap the oldest zombie before adding new one.
```

## Scope

Files changed:
- `packages/server/src/ws/session.ts` — ws nullable, event buffer, zombie lifecycle, attachSocket/detachSocket
- `packages/server/src/ws/index.ts` — RESUME handler, setupConnectionHandlers extraction, modified connection lifecycle
- `packages/server/src/ws/dispatcher.ts` — findZombieSession, reapZombieSession

Files unchanged:
- `packages/shared/` — opcodes already defined
- Plugin (client) — already fully implements RESUME

## Verification

1. Bot connects → note session_id
2. Kill bot's WebSocket (without stopping server)
3. Send a message to bot's channel during disconnect
4. Bot reconnects → RESUME → receives RESUMED + replayed message
5. Wait > 60s after disconnect → RESUME gets INVALID_SESSION → fresh IDENTIFY
6. Verify presence doesn't flicker on brief reconnects (stays online during zombie)
7. Verify zombie reaper fires: presence goes offline after TTL
8. Second disconnect+RESUME cycle works (closure rebinding correct)
9. Existing WS tests still pass
