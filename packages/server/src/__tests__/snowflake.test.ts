import { describe, it, expect } from "vitest";
import { generateSnowflake, snowflakeToTimestamp, snowflakeFromTimestamp, COVE_EPOCH } from "@cove/shared";

describe("Snowflake ID generation", () => {
  it("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateSnowflake());
    }
    expect(ids.size).toBe(1000);
  });

  it("generates IDs that are numeric strings", () => {
    const id = generateSnowflake();
    expect(id).toMatch(/^\d+$/);
  });

  it("generates IDs in monotonically increasing order", () => {
    const ids: bigint[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(BigInt(generateSnowflake()));
    }
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });

  it("extracts correct timestamp from snowflake", () => {
    const before = Date.now();
    const id = generateSnowflake();
    const after = Date.now();
    const ts = snowflakeToTimestamp(id);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("snowflakeFromTimestamp produces correct timestamp", () => {
    const ts = 1700000000000;
    const id = snowflakeFromTimestamp(ts);
    expect(snowflakeToTimestamp(id)).toBe(ts);
  });

  it("snowflakeFromTimestamp with different seqs produces different IDs", () => {
    const ts = 1700000000000;
    const id0 = snowflakeFromTimestamp(ts, 0);
    const id1 = snowflakeFromTimestamp(ts, 1);
    expect(id0).not.toBe(id1);
    // Both should extract to the same timestamp
    expect(snowflakeToTimestamp(id0)).toBe(ts);
    expect(snowflakeToTimestamp(id1)).toBe(ts);
    // Higher seq = higher ID value
    expect(BigInt(id1)).toBeGreaterThan(BigInt(id0));
  });

  it("comparing two snowflakes tells you which is newer", () => {
    const older = generateSnowflake();
    // Small delay to ensure different ms
    const start = Date.now();
    while (Date.now() === start) { /* spin */ }
    const newer = generateSnowflake();
    expect(BigInt(newer)).toBeGreaterThan(BigInt(older));
  });

  it("COVE_EPOCH matches Discord epoch", () => {
    expect(COVE_EPOCH).toBe(1420070400000n);
  });
});
