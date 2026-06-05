/**
 * Discord-compatible Snowflake ID generator.
 *
 * 64-bit integer stored as string to avoid JS precision loss.
 * Bit layout: Timestamp (42) | Worker ID (5) | Process ID (5) | Increment (12)
 */

/** Discord epoch: 2015-01-01T00:00:00.000Z */
export const COVE_EPOCH = 1420070400000n;

let lastTimestamp = 0n;
let increment = 0n;

const WORKER_ID = 0n;
const PROCESS_ID = 0n;

/** Generate a new Snowflake ID string. */
export function generateSnowflake(): string {
  let now = BigInt(Date.now());

  if (now < lastTimestamp) {
    // Clock went backward (NTP sync) — hold at last known timestamp to
    // maintain monotonicity and prevent duplicate/lower IDs.
    now = lastTimestamp;
  }

  if (now === lastTimestamp) {
    increment = (increment + 1n) & 0xFFFn; // 12-bit wrap
    if (increment === 0n) {
      // Exhausted increment space for this ms — spin until next ms
      while (now <= lastTimestamp) {
        now = BigInt(Date.now());
      }
    }
  } else {
    increment = 0n;
  }

  lastTimestamp = now;

  const id =
    ((now - COVE_EPOCH) << 22n) |
    (WORKER_ID << 17n) |
    (PROCESS_ID << 12n) |
    increment;

  return id.toString();
}

/** Generate a Snowflake from a specific timestamp (for migrations). Accepts ms epoch or ISO string. */
export function snowflakeFromTimestamp(timestamp: number | string, seq = 0): string {
  const ms = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;
  const ts = BigInt(ms) + BigInt(Math.floor(seq / 4096));
  const wrappedSeq = BigInt(seq % 4096);
  const id =
    ((ts - COVE_EPOCH) << 22n) |
    (WORKER_ID << 17n) |
    (PROCESS_ID << 12n) |
    wrappedSeq;
  return id.toString();
}

/** Extract the creation timestamp (ms since Unix epoch) from a Snowflake. */
export function snowflakeToTimestamp(id: string): number {
  const snowflake = BigInt(id);
  return Number((snowflake >> 22n) + COVE_EPOCH);
}
