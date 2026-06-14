import type Database from "better-sqlite3";
import { tableExists, addColumnIfMissing } from "./util.js";

export function migrateV13(db: Database.Database): void {
  if (tableExists(db, "pending_registrations")) {
    addColumnIfMissing(db, "pending_registrations", "global_name", "TEXT DEFAULT NULL");
  }
}
