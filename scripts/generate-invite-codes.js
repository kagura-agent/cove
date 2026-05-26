#!/usr/bin/env node
/**
 * Generate invite codes for Cove.
 *
 * Usage:
 *   node scripts/generate-invite-codes.js [count] [--db path/to/cove.db]
 *
 * Examples:
 *   node scripts/generate-invite-codes.js 5
 *   node scripts/generate-invite-codes.js 10 --db /data/cove.db
 */
import Database from "better-sqlite3";
import { randomUUID, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateCode() {
  let p1 = "", p2 = "";
  for (let i = 0; i < 4; i++) {
    p1 += CHARS[randomInt(0, CHARS.length)];
    p2 += CHARS[randomInt(0, CHARS.length)];
  }
  return `COVE-${p1}-${p2}`;
}

// Parse args
const args = process.argv.slice(2);
let count = 5;
let dbPath = resolve("cove.db");

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--db" && args[i + 1]) {
    dbPath = resolve(args[++i]);
  } else if (/^\d+$/.test(args[i])) {
    count = parseInt(args[i], 10);
  }
}

if (count < 1 || count > 100) {
  console.error("Count must be between 1 and 100");
  process.exit(1);
}

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);

// Ensure table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS invite_codes (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL,
    used_at INTEGER,
    used_by TEXT
  )
`);

const insert = db.prepare(
  "INSERT INTO invite_codes (id, code, created_at) VALUES (?, ?, ?)"
);
const now = Date.now();
const codes = [];

const generate = db.transaction(() => {
  for (let i = 0; i < count; i++) {
    const code = generateCode();
    insert.run(randomUUID(), code, now);
    codes.push(code);
  }
});
generate();

console.log(`Generated ${count} invite codes:\n`);
codes.forEach((c) => console.log(`  ${c}`));
console.log(`\nStored in: ${dbPath}`);

db.close();
