import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { GatewayOpcode, type GatewayPayload } from "@cove/shared";

/** Set of identified (authenticated) WebSocket clients. */
const identifiedClients = new Set<WebSocket>();

/** Heartbeat interval in milliseconds (Discord default-ish). */
const HEARTBEAT_INTERVAL = 41250;

/**
 * Set up Discord-compatible Gateway WebSocket server.
 *
 * Protocol:
 * 1. Client connects → server sends HELLO (op 10) with heartbeat_interval
 * 2. Client sends IDENTIFY (op 2) with token → server sends DISPATCH READY (op 0)
 * 3. Client sends HEARTBEAT (op 1) → server responds HEARTBEAT_ACK (op 11)
 * 4. Server broadcasts DISPATCH events (MESSAGE_CREATE, CHANNEL_UPDATE) to identified clients
 */
export function setupGateway(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: "/gateway" });

  wss.on("connection", (ws) => {
    // Send HELLO
    const hello: GatewayPayload = {
      op: GatewayOpcode.HELLO,
      d: { heartbeat_interval: HEARTBEAT_INTERVAL },
      s: null,
      t: null,
    };
    ws.send(JSON.stringify(hello));

    ws.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString()) as GatewayPayload;

        switch (payload.op) {
          case GatewayOpcode.IDENTIFY: {
            const data = payload.d as { token?: string } | null;
            const token = data?.token ?? "anonymous";

            identifiedClients.add(ws);

            // Send READY dispatch
            const ready: GatewayPayload = {
              op: GatewayOpcode.DISPATCH,
              s: 1,
              t: "READY",
              d: {
                v: 10,
                user: { id: token, username: token, bot: true },
                guilds: [{ id: "cove" }],
                session_id: randomUUID(),
              },
            };
            ws.send(JSON.stringify(ready));
            break;
          }

          case GatewayOpcode.HEARTBEAT: {
            const ack: GatewayPayload = {
              op: GatewayOpcode.HEARTBEAT_ACK,
              d: null,
              s: null,
              t: null,
            };
            ws.send(JSON.stringify(ack));
            break;
          }

          default:
            // Ignore unknown opcodes
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      identifiedClients.delete(ws);
    });
  });
}

/**
 * Broadcast a Gateway event to all identified clients.
 * The event should already be a full GatewayPayload (op 0 DISPATCH).
 */
export function broadcastGatewayEvent(event: unknown): void {
  const data = JSON.stringify(event);
  for (const ws of identifiedClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}
