import Database from "better-sqlite3";

export function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name);
}

export function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  return cols.some(c => c.name === column);
}

export function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e: unknown) {
    if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e;
  }
}

const SNOWFLAKE_RE = /^[0-9]+$/;
export function isSnowflake(id: string): boolean {
  return SNOWFLAKE_RE.test(id);
}

export function migrateRenameTable(db: Database.Database, oldName: string, newName: string): void {
  const hasOld = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(oldName);
  if (!hasOld) return;

  const hasNew = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(newName);
  if (hasNew) {
    const newCount = (db.prepare(`SELECT COUNT(*) as c FROM "${newName}"`).get() as { c: number }).c;
    if (newCount > 0) {
      const oldCount = (db.prepare(`SELECT COUNT(*) as c FROM "${oldName}"`).get() as { c: number }).c;
      if (oldCount > 0) {
        throw new Error(
          `Migration conflict: both "${oldName}" (${oldCount} rows) and "${newName}" (${newCount} rows) contain data. ` +
          `Manually resolve before starting the server.`
        );
      }
      db.exec(`DROP TABLE "${oldName}"`);
      return;
    }
    db.exec(`DROP TABLE "${newName}"`);
  }
  db.exec(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`);
}
