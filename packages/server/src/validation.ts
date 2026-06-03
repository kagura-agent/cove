import type { Context } from "hono";

export function validateString(
  value: unknown,
  name: string,
  opts?: { maxLength?: number; required?: boolean },
): string | null {
  if (value === undefined || value === null) {
    return opts?.required ? `${name} is required` : null;
  }
  if (typeof value !== "string") return `${name} must be a string`;
  if (opts?.required && value.trim() === "") return `${name} cannot be empty`;
  if (opts?.maxLength && value.length > opts.maxLength)
    return `${name} must be ${opts.maxLength} characters or fewer`;
  return null;
}

export function validateFiniteNumber(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value))
    return `${name} must be a finite number`;
  return null;
}

export function validationError(c: Context, message: string) {
  return c.json({ message, code: 50035 }, 400);
}

export async function parseJsonBody<T = Record<string, unknown>>(c: Context): Promise<T | null> {
  try {
    return await c.req.json<T>();
  } catch {
    return null;
  }
}
