import { serve } from "@hono/node-server";
import { initDb, seedScenes } from "./db/schema.js";
import { createApp } from "./app.js";
import { setupWebSocket, broadcastToScene } from "./ws/index.js";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const DB_PATH = process.env["DB_PATH"] ?? "cove.db";

// Initialize database
const db = initDb(DB_PATH);
seedScenes(db);
console.log("🏝️  Database initialized and seeded");

// Create Hono app with broadcast wired up
const app = createApp(db, broadcastToScene);

// Start HTTP server
const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`🏝️  Cove server running on http://localhost:${info.port}`);
});

// Attach WebSocket server
setupWebSocket(server);
console.log("🏝️  WebSocket server ready on /ws");
