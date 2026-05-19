/**
 * Cove shared types — used by both server and client packages.
 */

/** A scene in the Cove world, mapped to an OpenClaw channel. */
export interface Scene {
  id: string;
  name: string;
  icon: string;
  type: "open" | "indoor" | "object" | "structure";
  channelId: string;
  description: string;
  position: { x: number; y: number };
}

/** A message sent within a scene. */
export interface Message {
  id: string;
  sceneId: string;
  sender: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/** Key-value state entry for a scene (e.g. "flowers_watered_today": "3"). */
export interface SceneState {
  sceneId: string;
  key: string;
  value: string;
  updatedAt: number;
}

/** WebSocket event types for real-time scene updates. */
export type WSEvent =
  | { type: "message"; payload: Message }
  | { type: "state_update"; payload: SceneState }
  | { type: "subscribe"; payload: { sceneId: string } }
  | { type: "unsubscribe"; payload: { sceneId: string } };
