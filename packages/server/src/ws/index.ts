import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer } from "ws";
import type { UsersRepo } from "../repos/users.js";
import type { GuildsRepo } from "../repos/guilds.js";
import type { ReadStatesRepo } from "../repos/readStates.js";
import { GatewayOpcode, type GatewayPayload } from "@cove/shared";
import { GatewaySession } from "./session.js";
import { GatewayDispatcher } from "./dispatcher.js";
import { SESSION_COOKIE } from "../auth.js";

const HEARTBEAT_INTERVAL = 41250;
const HEARTBEAT_TIMEOUT = HEARTBEAT_INTERVAL * 2;

/** Simple cookie parser for raw HTTP upgrade requests (no hono dependency) */
function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name) {
      try {
        cookies[name.trim()] = decodeURIComponent(rest.join("=").trim());
      } catch {
        // Skip malformed cookie values
      }
    }
  }
  return cookies;
}

export function setupGateway(server: HttpServer, users: UsersRepo, guilds: GuildsRepo, dispatcher: GatewayDispatcher, readStates: ReadStatesRepo): void {
  const wss = new WebSocketServer({
    server,
    path: "/gateway",
    verifyClient: ({ req }, done) => {
      // Pre-authenticate browser clients via session cookie at upgrade time
      const cookies = parseCookies(req.headers.cookie);
      const sessionToken = cookies[SESSION_COOKIE];
      if (sessionToken) {
        const row = users.findByToken(sessionToken);
        if (row) {
          (req as IncomingMessage & { __coveUser?: { id: string; username: string; bot: boolean } }).__coveUser = {
            id: row.id, username: row.username, bot: row.bot,
          };
        }
      }
      // Always allow the connection — IDENTIFY with token is still valid for bots
      done(true);
    },
  });

  wss.on("connection", (ws, request) => {
    const session = new GatewaySession(ws);
    let lastHeartbeat = Date.now();
    let heartbeatCheck: ReturnType<typeof setInterval> | null = null;

    // Check if user was pre-authenticated at upgrade via cookie
    const preAuthUser = (request as IncomingMessage & { __coveUser?: { id: string; username: string; bot: boolean } }).__coveUser;

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

            // Try explicit token first (bot clients), then fall back to cookie pre-auth
            let user: { id: string; username: string; bot: boolean } | undefined;

            if (token) {
              const row = users.findByToken(token);
              if (row) {
                user = { id: row.id, username: row.username, bot: row.bot };
              }
            }

            if (!user && preAuthUser) {
              user = preAuthUser;
            }

            if (!user) {
              if (heartbeatCheck) clearInterval(heartbeatCheck);
              // Distinguish: no credentials at all vs invalid token
              if (!token && !preAuthUser) {
                session.close(4001, "Token required");
              } else {
                session.close(4004, "Authentication failed");
              }
              return;
            }

            session.identify(user, dispatcher, guilds, readStates);
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
