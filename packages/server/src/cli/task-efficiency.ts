#!/usr/bin/env tsx
/**
 * Task efficiency report CLI (#572 Phase 1).
 *
 * Dumps the per-task efficiency report (cost / tool health / run health /
 * baseline) for one task or every task in a channel, computed from existing
 * data — no schema changes.
 *
 * Usage:
 *   tsx src/cli/task-efficiency.ts task <taskId> [--db <path>] [--log-dir <dir>] [--baseline channel|all] [--json]
 *   tsx src/cli/task-efficiency.ts channel <channelId> [--db <path>] [--log-dir <dir>] [--baseline channel|all] [--json]
 *   tsx src/cli/task-efficiency.ts channels [--db <path>] [--log-dir <dir>] [--json]
 *
 * Env overrides: COVE_DB_PATH, COVE_AGENT_RUN_LOG_DIR (same as the server).
 * Default db path: ./cove.db, default log dir: ./data/agent-runs.
 */
import { initDb } from "../db/schema.js";
import { createRepos, type TaskEfficiencyRepo } from "../repos/index.js";

function parseArgs(argv: string[]) {
  const args = { cmd: "", id: "", db: "", logDir: "", baseline: "channel" as "channel" | "all", json: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") args.db = argv[++i] ?? "";
    else if (a === "--log-dir") args.logDir = argv[++i] ?? "";
    else if (a === "--baseline") args.baseline = (argv[++i] ?? "channel") === "all" ? "all" : "channel";
    else if (a === "--json") args.json = true;
    else rest.push(a);
  }
  args.cmd = rest[0] ?? "";
  args.id = rest[1] ?? "";
  return args;
}

function fmtCost(cost: number | null | undefined): string {
  return cost == null ? "n/a" : `$${cost.toFixed(2)}`;
}

function fmtRate(rate: number | null | undefined): string {
  return rate == null ? "n/a" : `${(rate * 100).toFixed(1)}%`;
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "n/a";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function printReport(report: ReturnType<TaskEfficiencyRepo["report"]>) {
  if (!report) { console.log("(no report — task not found or has no thread)"); return; }
  const lines = [
    `task        ${report.task_id}`,
    `has_data    ${report.has_data}`,
    ``,
    `-- cost --`,
    `  calls          ${report.cost?.calls ?? 0}`,
    `  cost           ${fmtCost(report.cost?.cost)}`,
    `  input tokens   ${report.cost?.input_tokens.toLocaleString() ?? 0}`,
    `  output tokens  ${report.cost?.output_tokens.toLocaleString() ?? 0}`,
    `  cache read     ${report.cost?.cache_read_tokens.toLocaleString() ?? 0}`,
    `  cache write    ${report.cost?.cache_write_tokens.toLocaleString() ?? 0}`,
    `  total tokens   ${report.cost?.total_tokens.toLocaleString() ?? 0}`,
    ``,
    `-- tool health --`,
    `  tool calls     ${report.tool_health?.tool_calls ?? 0}`,
    `  failures       ${report.tool_health?.failures ?? 0}`,
    `  failure rate   ${fmtRate(report.tool_health?.failure_rate)}`,
  ];
  if (report.tool_health?.top_failing_commands.length) {
    lines.push(`  top failures:`);
    for (const c of report.tool_health.top_failing_commands.slice(0, 5)) {
      lines.push(`    ${c.failures}×  ${c.command.slice(0, 100)}`);
    }
  }
  if (report.tool_health?.repeated_commands.length) {
    lines.push(`  repeated commands:`);
    for (const c of report.tool_health.repeated_commands.slice(0, 5)) {
      lines.push(`    ${c.occurrences}×  ${c.command.slice(0, 100)}`);
    }
  }
  lines.push(
    ``,
    `-- run health --`,
    `  runs            ${report.run_health?.runs ?? 0}`,
    `  sessions        ${report.run_health?.sessions ?? 0}`,
    `  completed       ${report.run_health?.completed ?? 0}`,
    `  failed          ${report.run_health?.failed ?? 0}`,
    `  aborted         ${report.run_health?.aborted ?? 0}`,
    `  stale           ${report.run_health?.stale ?? 0}`,
    `  active          ${report.run_health?.active ?? 0}`,
    `  completion rate ${fmtRate(report.run_health?.completion_rate)}`,
    `  duration median ${fmtDuration(report.run_health?.duration_ms_median)}`,
    `  duration total  ${fmtDuration(report.run_health?.duration_ms_total)}`,
    ``,
    `-- baseline (${report.baseline.scope}) --`,
    `  tasks included      ${report.baseline.tasks_included}`,
    `  median cost         ${fmtCost(report.baseline.median_cost)}`,
    `  median failure rate ${fmtRate(report.baseline.median_failure_rate)}`,
    `  cost delta          ${report.cost_delta_vs_median == null ? "n/a" : (report.cost_delta_vs_median >= 0 ? "+" : "") + fmtCost(report.cost_delta_vs_median)}`,
    `  failure delta       ${report.failure_rate_delta_vs_median == null ? "n/a" : (report.failure_rate_delta_vs_median >= 0 ? "+" : "") + (report.failure_rate_delta_vs_median * 100).toFixed(1) + "%"}`,
  );
  console.log(lines.join("\n"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.db || process.env["COVE_DB_PATH"] || "cove.db";
  // AgentRunsRepo reads its log root from COVE_AGENT_RUN_LOG_DIR at
  // construction time — set it from the CLI arg so events.jsonl evidence is
  // found regardless of the caller's cwd.
  if (args.logDir) process.env["COVE_AGENT_RUN_LOG_DIR"] = args.logDir;
  const db = initDb(dbPath);
  const repos = createRepos(db);
  const eff = repos.taskEfficiency;
  if (args.cmd === "task") {
    const report = eff.report(args.id, { baselineScope: args.baseline });
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else printReport(report);
  } else if (args.cmd === "channel") {
    const reports = eff.channelReports(args.id, { baselineScope: args.baseline });
    if (args.json) { console.log(JSON.stringify(reports, null, 2)); return; }
    for (const r of reports) { printReport(r); console.log(""); }
    console.log(`${reports.length} task(s)`);
  } else if (args.cmd === "channels") {
    const channels = db.prepare("SELECT id FROM channels WHERE type = 0 ORDER BY position").all() as Array<{ id: string }>;
    const all: Array<{ channel_id: string; report: ReturnType<TaskEfficiencyRepo["report"]> }> = [];
    for (const ch of channels) {
      for (const r of eff.channelReports(ch.id, { baselineScope: args.baseline })) {
        all.push({ channel_id: ch.id, report: r });
      }
    }
    if (args.json) { console.log(JSON.stringify(all.map((x) => x.report), null, 2)); return; }
    for (const { channel_id, report } of all) {
      console.log(`== channel ${channel_id} ==`);
      printReport(report);
      console.log("");
    }
    console.log(`${all.length} task(s) across ${channels.length} channel(s)`);
  } else {
    console.error("Usage: tsx src/cli/task-efficiency.ts <task|channel|channels> <id> [--db <path>] [--log-dir <dir>] [--baseline channel|all] [--json]");
    process.exit(1);
  }
  db.close();
}

main();
