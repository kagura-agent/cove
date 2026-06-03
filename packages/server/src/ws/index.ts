import type { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import type { UsersRepo } from "../repos/users.js";
import { GatewayOpcode, type GatewayPayload } from "@cove/shared";
import { GatewaySession } from "./session.js";
import { GatewayDispatcher } from "./dispatcher.js";

const HEARTBEAT_INTERVAL = 41250;
const HEARTBEAT_TIMEOUT = HEARTBEAT_INTERVAL * 2;

export function setupGateway(server: HttpServer, users: UsersRepo, dispatcher: GatewayDispatcher): void {
  const wss = new WebSocketServer({ server, path: "/gateway" });

  wss.on("connection", (ws) => {
    const session = new GatewaySession(ws);
    let lastHeartbeat = Date.now();
    let heartbeatCheck: ReturnType<typeof setInterval> | null = null;

    session.send({
      op: GatewayOpcode.HELLO,
      d: { heartbeat_interval: HEARTBEAT_INTERVAL },
      s: null,
      t: null,
    });

    // Start heartbeat timeout check after HELLO
    heartbeatCheck = setInterval(() => {
      if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
        if (heartbeatCheck) clearInterval(heartbeatCheck);
        session.close(4009, "Session timed out");
      }
    }, HEARTBEAT_INTERVAL);

    ws.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString()) as GatewayPayload;

        switch (payload.op) {
          case GatewayOpcode.IDENTIFY: {
            if (session.isIdentified) {
              session.close(4005, "Already identified");
              return;
            }

            const data = payload.d as { token?: string } | null;
            const token = data?.token;

            if (!token) {
              if (heartbeatCheck) clearInterval(heartbeatCheck);
              session.close(4001, "Token required");
              return;
            }

            const row = users.findByToken(token);
            if (!row) {
              if (heartbeatCheck) clearInterval(heartbeatCheck);
              session.close(4004, "Authentication failed");
              return;
            }

            const user = { id: row.id, username: row.username, bot: row.bot };

            session.identify(user, dispatcher);
            dispatcher.addSession(session);
            break;
          }

          case GatewayOpcode.HEARTBEAT: {
            lastHeartbeat = Date.now();
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
      if (heartbeatCheck) clearInterval(heartbeatCheck);
      dispatcher.removeSession(session);
    });
  });
}

export { GatewayDispatcher } from "./dispatcher.js";
export { GatewaySession } from "./session.js";
