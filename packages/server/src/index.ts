import { serve } from "@hono/node-server";
import { initDb, seedScenes } from "./db/schema.js";
import { createApp } from "./app.js";
import { setupGateway, broadcastGatewayEvent } from "./ws/index.js";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const DB_PATH = process.env["DB_PATH"] ?? "cove.db";
const BOT_TOKEN = process.env["COVE_BOT_TOKEN"];

// Initialize database
const db = initDb(DB_PATH);
seedScenes(db);
console.log("🏝️  Database initialized and seeded");

// Create Hono app with broadcast wired up
const app = createApp(db, broadcastGatewayEvent, {
  botToken: BOT_TOKEN,
  gatewayUrl: `ws://localhost:${PORT}/gateway`,
});

if (BOT_TOKEN) {
  console.log("🔒  Bot token auth enabled");
}

// Start HTTP server
const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`🏝️  Cove server running on http://localhost:${info.port}`);
});

// Attach Gateway WebSocket server
setupGateway(server);
console.log("🏝️  Gateway WebSocket ready on /gateway");
