import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer } from "ws";
import type { UsersRepo } from "../repos/users.js";
import type { GuildsRepo } from "../repos/guilds.js";
import type { ChannelsRepo } from "../repos/channels.js";
import type { ReadStatesRepo } from "../repos/readStates.js";
import type { PermissionsRepo } from "../repos/permissions.js";
import type { RolesRepo } from "../repos/roles.js";
import type { MembersRepo } from "../repos/members.js";
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

export function setupGateway(server: HttpServer, users: UsersRepo, guilds: GuildsRepo, channels: ChannelsRepo, dispatcher: GatewayDispatcher, readStates: ReadStatesRepo, permissions?: PermissionsRepo, roles?: RolesRepo, members?: MembersRepo): void {
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
          (req as IncomingMessage & { __coveUser?: { id: string; username: string; bot: boolean; avatar: string | null; discriminator: string; global_name: string | null; expires_at: number | null } }).__coveUser = {
            id: row.id, username: row.username, bot: row.bot, avatar: row.avatar ?? null, discriminator: "0", global_name: row.global_name ?? null, expires_at: row.expires_at ?? null,
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
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let sessionToken: string | null = null;

    // Check if user was pre-authenticated at upgrade via cookie
    const preAuthUser = (request as IncomingMessage & { __coveUser?: { id: string; username: string; bot: boolean; avatar: string | null; discriminator: string; global_name: string | null; expires_at: number | null } }).__coveUser;

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
            let identifyToken = data?.token;

            // Try explicit token first (bot clients), then fall back to cookie pre-auth
            let user: { id: string; username: string; bot: boolean; avatar: string | null; discriminator: string; global_name: string | null; expires_at: number | null } | undefined;

            if (identifyToken) {
              const row = users.findByToken(identifyToken);
              if (row) {
                user = { id: row.id, username: row.username, bot: row.bot, avatar: row.avatar ?? null, discriminator: "0", global_name: row.global_name ?? null, expires_at: row.expires_at ?? null };
              }
            }

            // Explicit token invalid but cookie pre-auth exists: use cookie identity.
            // This handles browser clients sending { token: null } over a cookie-authenticated socket.
            if (!user && preAuthUser) {
              user = preAuthUser;
              // Always use the cookie token for expiry checks when falling back to cookie auth.
              // If the client sent an invalid explicit token, we must NOT use it for session validation.
              const cookies = parseCookies(request.headers.cookie);
              identifyToken = cookies[SESSION_COOKIE] || undefined;
            }

            if (!user) {
              if (heartbeatCheck) clearInterval(heartbeatCheck);
              // Distinguish: no credentials at all vs invalid token
              if (!identifyToken && !preAuthUser) {
                session.close(4001, "Token required");
              } else {
                session.close(4004, "Authentication failed");
              }
              return;
            }

            session.identify(user, dispatcher, guilds, channels, readStates, permissions, roles, members);
            dispatcher.addSession(session);

            // Schedule session expiry disconnect for non-bot users
            if (!user.bot && user.expires_at) {
              sessionToken = identifyToken || null;
              const ttl = user.expires_at - Date.now();
              if (ttl > 0) {
                scheduleExpiry(sessionToken!, ttl);
              } else {
                // Already expired
                session.close(4004, "Authentication expired");
              }
            }
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

    /** Cap to prevent setTimeout overflow (>2^31-1 ms fires immediately) */
    const MAX_TIMEOUT = 2_147_483_647;

    function scheduleExpiry(token: string, delayMs: number) {
      if (expiryTimer) clearTimeout(expiryTimer);
      expiryTimer = setTimeout(() => {
        const row = users.findByToken(token);
        if (!row || !row.expires_at) {
          if (heartbeatCheck) clearInterval(heartbeatCheck);
          session.close(4004, "Authentication expired");
          return;
        }
        const remaining = row.expires_at - Date.now();
        if (remaining <= 0) {
          if (heartbeatCheck) clearInterval(heartbeatCheck);
          session.close(4004, "Authentication expired");
        } else {
          scheduleExpiry(token, remaining);
        }
      }, Math.min(delayMs, MAX_TIMEOUT));
    }

    ws.on("close", () => {
      if (heartbeatCheck) clearInterval(heartbeatCheck);
      if (expiryTimer) clearTimeout(expiryTimer);
      dispatcher.removeSession(session);
    });
  });
}

export { GatewayDispatcher } from "./dispatcher.js";
export { GatewaySession } from "./session.js";
