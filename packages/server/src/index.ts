import { serve } from "@hono/node-server";
import { initDb, seedChannels, seedUsers } from "./db/schema.js";
import { createApp } from "./app.js";
import { createRepos } from "./repos/index.js";
import { setupGateway, GatewayDispatcher } from "./ws/index.js";

const PORT = parseInt(process.env["PORT"] ?? "3400", 10);
const DB_PATH = process.env["COVE_DB_PATH"] ?? process.env["DB_PATH"] ?? "cove.db";

const db = initDb(DB_PATH);
const repos = createRepos(db);
const defaultGuildId = repos.guilds.getDefaultId(); // Fail-fast: verify default guild exists
seedChannels(db, defaultGuildId);
seedUsers(db, defaultGuildId);

// #208: TTL cleanup for stale records
const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const USED_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const now = Date.now();
db.prepare("DELETE FROM pending_registrations WHERE created_at < ?").run(now - PENDING_TTL_MS);
db.prepare("DELETE FROM invite_codes WHERE used_at IS NOT NULL AND used_at < ?").run(now - USED_INVITE_TTL_MS);

console.log("🏝️  Database initialized and seeded");

// #118: Periodic session TTL cleanup — remove expired human sessions every hour
const SESSION_CLEANUP_INTERVAL_MS = 3_600_000; // 1 hour
const sessionCleanupTimer = setInterval(() => {
  try {
    const removed = repos.users.cleanupExpired();
    if (removed > 0) console.log(`🧹 Session cleanup: cleared ${removed} expired tokens`);
  } catch (err) {
    console.error('Session cleanup failed:', err);
  }
}, SESSION_CLEANUP_INTERVAL_MS);
sessionCleanupTimer.unref();

const googleClientId = process.env["GOOGLE_CLIENT_ID"];
const googleClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
const baseUrl = process.env["BASE_URL"] ?? `http://localhost:${PORT}`;

const dispatcher = new GatewayDispatcher(repos.channels, repos.guilds);
dispatcher.setPermissionsRepo(repos.permissions);
dispatcher.setMembersRepo(repos.members);
dispatcher.setRolesRepo(repos.roles);

const app = createApp(db, repos, dispatcher, {
  gatewayUrl: process.env["GATEWAY_URL"] ?? `ws://localhost:${PORT}/gateway`,
  oauth: googleClientId && googleClientSecret ? {
    clientId: googleClientId,
    clientSecret: googleClientSecret,
    redirectUri: `${baseUrl}/api/auth/callback`,
  } : undefined,
});

console.log("🔒  Bot token auth enabled (per-user tokens)");

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`🏝️  Cove server running on http://localhost:${info.port}`);
});

setupGateway(server as any, repos.users, repos.guilds, repos.channels, dispatcher, repos.readStates, repos.permissions, repos.roles, repos.members);
console.log("🏝️  Gateway WebSocket ready on /gateway");
