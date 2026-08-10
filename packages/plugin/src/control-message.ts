import { isAbortRequestText } from "openclaw/plugin-sdk/command-primitives-runtime";

/**
 * Only abort requests bypass Cove's serial presentation queue. They still enter
 * OpenClaw's regular inbound dispatcher, which owns authorization and actual
 * SessionKey cancellation.
 */
export function shouldDispatchImmediately(message: { content: string }): boolean {
  return isAbortRequestText(message.content);
}
