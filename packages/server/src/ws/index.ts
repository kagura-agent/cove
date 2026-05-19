import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { WSEvent } from "@cove/shared";

/** Map of sceneId → set of subscribed WebSocket clients */
const subscriptions = new Map<string, Set<WebSocket>>();

/**
 * Set up WebSocket server on the given HTTP server.
 * Clients send JSON messages to subscribe/unsubscribe to scene updates.
 */
export function setupWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    const clientScenes = new Set<string>();

    ws.on("message", (raw) => {
      try {
        const event = JSON.parse(raw.toString()) as WSEvent;

        if (event.type === "subscribe") {
          const { sceneId } = event.payload;
          clientScenes.add(sceneId);
          if (!subscriptions.has(sceneId)) {
            subscriptions.set(sceneId, new Set());
          }
          subscriptions.get(sceneId)!.add(ws);
        }

        if (event.type === "unsubscribe") {
          const { sceneId } = event.payload;
          clientScenes.delete(sceneId);
          subscriptions.get(sceneId)?.delete(ws);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      // Clean up all subscriptions for this client
      for (const sceneId of clientScenes) {
        subscriptions.get(sceneId)?.delete(ws);
        if (subscriptions.get(sceneId)?.size === 0) {
          subscriptions.delete(sceneId);
        }
      }
    });
  });
}

/**
 * Broadcast an event to all WebSocket clients subscribed to a scene.
 */
export function broadcastToScene(sceneId: string, event: unknown): void {
  const clients = subscriptions.get(sceneId);
  if (!clients) return;

  const data = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}
