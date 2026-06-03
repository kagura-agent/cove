import type { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import type Database from "better-sqlite3";
import { GatewayOpcode, type GatewayPayload } from "@cove/shared";
import { GatewaySession } from "./session.js";
import { GatewayDispatcher } from "./dispatcher.js";

const HEARTBEAT_INTERVAL = 41250;

export function setupGateway(server: HttpServer, db: Database.Database, dispatcher: GatewayDispatcher): void {
  const wss = new WebSocketServer({ server, path: "/gateway" });

  wss.on("connection", (ws) => {
    const session = new GatewaySession(ws);

    session.send({
      op: GatewayOpcode.HELLO,
      d: { heartbeat_interval: HEARTBEAT_INTERVAL },
      s: null,
      t: null,
    });

    ws.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString()) as GatewayPayload;

        switch (payload.op) {
          case GatewayOpcode.IDENTIFY: {
            const data = payload.d as { token?: string } | null;
            const token = data?.token;

            if (!token) {
              session.close(4001, "Token required");
              return;
            }

            const row = db.prepare("SELECT id, username, bot FROM users WHERE token = ?").get(token) as { id: string; username: string; bot: number } | undefined;
            if (!row) {
              session.close(4004, "Authentication failed");
              return;
            }

            const user = { id: row.id, username: row.username, bot: row.bot === 1 };

            session.identify(user);
            dispatcher.addSession(session);
            break;
          }

          case GatewayOpcode.HEARTBEAT: {
            session.send({
              op: GatewayOpcode.HEARTBEAT_ACK,
              d: null,
              s: null,
              t: null,
            });
            break;
          }

          case GatewayOpcode.REQUEST_TYPING: {
            if (!session.isIdentified || !session.user) break;
            const d = payload.d as { channel_id?: string } | null;
            if (!d?.channel_id) break;
            dispatcher.typingStart(d.channel_id, session.user);
            break;
          }

          default:
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      dispatcher.removeSession(session);
    });
  });
}

export { GatewayDispatcher } from "./dispatcher.js";
export { GatewaySession } from "./session.js";
