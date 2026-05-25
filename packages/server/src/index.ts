import { serve } from "@hono/node-server";
import { initDb, seedScenes, seedUsers } from "./db/schema.js";
import { createApp } from "./app.js";
import { setupGateway, broadcastGatewayEvent } from "./ws/index.js";

const PORT = parseInt(process.env["PORT"] ?? "3400", 10);
const DB_PATH = process.env["COVE_DB_PATH"] ?? process.env["DB_PATH"] ?? "cove.db";

// Initialize database
const db = initDb(DB_PATH);
seedScenes(db);
seedUsers(db);
console.log("🏝️  Database initialized and seeded");

const googleClientId = process.env["GOOGLE_CLIENT_ID"];
const googleClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
const baseUrl = process.env["BASE_URL"] ?? `http://localhost:${PORT}`;

// Create Hono app with broadcast wired up
const app = createApp(db, broadcastGatewayEvent, {
  gatewayUrl: process.env["GATEWAY_URL"] ?? `ws://localhost:${PORT}/gateway`,
  oauth: googleClientId && googleClientSecret ? {
    clientId: googleClientId,
    clientSecret: googleClientSecret,
    redirectUri: `${baseUrl}/api/auth/callback`,
  } : undefined,
});

console.log("🔒  Bot token auth enabled (per-user tokens)");

// Start HTTP server
const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`🏝️  Cove server running on http://localhost:${info.port}`);
});

// Attach Gateway WebSocket server
setupGateway(server as any, db);
console.log("🏝️  Gateway WebSocket ready on /gateway");
