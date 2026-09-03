import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

type ErrorResponse = {
  message: string;
  code?: number;
  status: 400 | 403 | 404;
};

const ERRORS = {
  invalidEmoji: { message: "Invalid emoji", status: 400 },
  missingPermissions: { message: "Missing Permissions", code: 50013, status: 403 },
  threadArchived: { message: "This thread is archived", code: 50083, status: 403 },
  threadInsideThread: { message: "Cannot create a thread inside a thread", code: 50035, status: 400 },
  threadLocked: { message: "This thread is locked", code: 50083, status: 403 },
  unknownChannel: { message: "Unknown Channel", code: 10003, status: 404 },
  unknownFile: { message: "Unknown File", code: 10014, status: 404 },
  unknownGuild: { message: "Unknown Guild", code: 10004, status: 404 },
  unknownMember: { message: "Unknown Member", code: 10007, status: 404 },
  unknownMessage: { message: "Unknown Message", code: 10008, status: 404 },
  unknownRecurringTask: { message: "Unknown Recurring Task", code: 10080, status: 404 },
  unknownRole: { message: "Unknown Role", code: 10011, status: 404 },
  unknownTask: { message: "Unknown Task", code: 10080, status: 404 },
  unknownUser: { message: "Unknown User", code: 10013, status: 404 },
  unknownWebhook: { message: "Unknown Webhook", code: 10015, status: 404 },
} as const satisfies Record<string, ErrorResponse>;

export function errorResponse(c: Context, error: ErrorResponse, status = error.status) {
  const body = error.code === undefined ? { message: error.message } : { message: error.message, code: error.code };
  return c.json(body, status);
}

export function errorException(error: ErrorResponse): HTTPException {
  const res = new Response(JSON.stringify({ message: error.message, code: error.code }), {
    status: error.status,
    headers: { "Content-Type": "application/json" },
  });
  return new HTTPException(error.status, { res });
}

export const missingPermissions = (c: Context) => errorResponse(c, ERRORS.missingPermissions);
export const invalidEmoji = (c: Context) => errorResponse(c, ERRORS.invalidEmoji);
export const threadArchived = (c: Context) => errorResponse(c, ERRORS.threadArchived);
export const threadInsideThread = (c: Context) => errorResponse(c, ERRORS.threadInsideThread);
export const threadLocked = (c: Context) => errorResponse(c, ERRORS.threadLocked);
export const unknownChannel = (c: Context) => errorResponse(c, ERRORS.unknownChannel);
export const unknownFile = (c: Context) => errorResponse(c, ERRORS.unknownFile);
export const unknownGuild = (c: Context) => errorResponse(c, ERRORS.unknownGuild);
export const unknownMember = (c: Context) => errorResponse(c, ERRORS.unknownMember);
export const unknownMessage = (c: Context, status: 400 | 404 = 404) => errorResponse(c, ERRORS.unknownMessage, status);
export const unknownRecurringTask = (c: Context) => errorResponse(c, ERRORS.unknownRecurringTask);
export const unknownRole = (c: Context) => errorResponse(c, ERRORS.unknownRole);
export const unknownTask = (c: Context) => errorResponse(c, ERRORS.unknownTask);
export const unknownUser = (c: Context) => errorResponse(c, ERRORS.unknownUser);
export const unknownWebhook = (c: Context) => errorResponse(c, ERRORS.unknownWebhook);

export const errorDefinitions = ERRORS;
