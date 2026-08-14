import { describe, expect, it } from "vitest";
import { initDb, seedChannels } from "../db/schema.js";
import { createRepos } from "../repos/index.js";

describe("agent run usage ledger", () => {
  function setup() {
    const db = initDb();
    const repos = createRepos(db);
    const guild = db.prepare("SELECT id FROM guilds LIMIT 1").get() as { id: string };
    seedChannels(db, guild.id);
    const channel = db.prepare("SELECT id FROM channels LIMIT 1").get() as { id: string };
    db.prepare("INSERT INTO users (id,username,bot,created_at,updated_at) VALUES ('agent','agent',1,1,1)").run();
    db.prepare("INSERT INTO messages (id,channel_id,sender,content,timestamp) VALUES ('m1',?,'agent','go',1)").run(channel.id);
    return { db, repos, channel };
  }

  it("records per-call usage and aggregates totals with price-table cost", () => {
    const { db, repos, channel } = setup();
    const run = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "m1" });
    repos.agentRuns.recordUsage(run.run_id, { provider: "floway-sg", model: "deepseek-v4-flash", input_tokens: 1_000_000, output_tokens: 500_000, cache_read_tokens: 2_000_000, cost: 0.25, cost_source: "price_table" });
    repos.agentRuns.recordUsage(run.run_id, { provider: "floway-sg", model: "deepseek-v4-flash", input_tokens: 100_000, output_tokens: 50_000, cost: 0.025, cost_source: "price_table" });

    const usage = repos.agentRuns.usage(run.run_id)!;
    expect(usage).toMatchObject({
      calls: 2,
      input_tokens: 1_100_000,
      output_tokens: 550_000,
      cache_read_tokens: 2_000_000,
      total_tokens: 3_650_000,
      cost: 0.275,
      currency: "USD",
      cost_source: "price_table",
    });
    expect(usage.models).toEqual([{ model: "deepseek-v4-flash", calls: 2, input_tokens: 1_100_000, output_tokens: 550_000, cost: 0.275 }]);
    db.close();
  });

  it("returns null usage when no calls were recorded", () => {
    const { db, repos, channel } = setup();
    const run = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "m1" });
    expect(repos.agentRuns.usage(run.run_id)).toBeNull();
    db.close();
  });

  it("treats missing cost as none without inventing a number", () => {
    const { db, repos, channel } = setup();
    const run = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "m1" });
    repos.agentRuns.recordUsage(run.run_id, { provider: "unknown-provider", model: "unknown-model", input_tokens: 100, output_tokens: 50 });
    const usage = repos.agentRuns.usage(run.run_id)!;
    expect(usage.cost).toBeNull();
    expect(usage.cost_source).toBe("none");
    db.close();
  });

  it("rolls child runs into the parent usage summary", () => {
    const { db, repos, channel } = setup();
    const parent = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, trigger_message_id: "m1" });
    const child = repos.agentRuns.start({ agent_id: "agent", channel_id: channel.id, thread_id: channel.id, trigger_message_id: "m1", parent_run_id: parent.run_id });
    repos.agentRuns.recordUsage(parent.run_id, { provider: "p", model: "m1", input_tokens: 100, output_tokens: 10, cost: 0.01, cost_source: "price_table" });
    repos.agentRuns.recordUsage(child.run_id, { provider: "p", model: "m2", input_tokens: 200, output_tokens: 20, cost: 0.02, cost_source: "price_table" });

    const own = repos.agentRuns.usage(parent.run_id, false)!;
    expect(own.calls).toBe(1);
    expect(own.input_tokens).toBe(100);

    const rolled = repos.agentRuns.usage(parent.run_id, true)!;
    expect(rolled.calls).toBe(2);
    expect(rolled.input_tokens).toBe(300);
    expect(rolled.cost).toBe(0.03);
    db.close();
  });
});
