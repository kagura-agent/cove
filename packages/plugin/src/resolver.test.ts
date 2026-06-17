import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("openclaw/plugin-sdk/target-resolver-runtime", () => ({
  resolveTargetsWithOptionalToken: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/channel-outbound", () => ({
  createChannelMessageAdapterFromOutbound: vi.fn().mockReturnValue({}),
}));

vi.mock("openclaw/plugin-sdk/text-chunking", () => ({
  chunkTextForOutbound: vi.fn((text: string) => [text]),
}));

import { coveChannelPlugin, resolveAccount } from "./channel.js";
import { resolveTargetsWithOptionalToken } from "openclaw/plugin-sdk/target-resolver-runtime";

const mockedResolve = vi.mocked(resolveTargetsWithOptionalToken);

function makeCfg(overrides: Record<string, unknown> = {}) {
  return {
    channels: {
      cove: {
        token: "test-token",
        baseUrl: "http://localhost:3400",
        guildId: "guild-1",
        agentId: "test-agent",
        ...overrides,
      },
    },
  };
}

const fakeChannels = [
  { id: "ch-1", name: "general", type: 0, guild_id: "guild-1", topic: null, position: 0, last_message_id: null, permission_overwrites: [], nsfw: false, rate_limit_per_user: 0 },
  { id: "ch-2", name: "Beach", type: 0, guild_id: "guild-1", topic: null, position: 1, last_message_id: null, permission_overwrites: [], nsfw: false, rate_limit_per_user: 0 },
];

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);

  mockedResolve.mockImplementation(async (params) => {
    if (!params.token) {
      return params.inputs.map((input) => ({
        input,
        resolved: false,
        note: params.missingTokenNote,
      }));
    }
    const results = await params.resolveWithToken({ token: params.token, inputs: params.inputs });
    return results.map(params.mapResolved);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockChannelsResponse(channels = fakeChannels) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => Promise.resolve(channels),
  } as unknown as Response);
}

const resolveTargets = coveChannelPlugin.resolver!.resolveTargets as (
  params: { cfg: any; accountId?: string | null; inputs: string[]; kind: string },
) => Promise<Array<{ input: string; resolved: boolean; id?: string; name?: string; note?: string }>>;

describe("resolver — group kind", () => {
  it("resolves by channel ID", async () => {
    mockChannelsResponse();
    const results = await resolveTargets({ cfg: makeCfg(), inputs: ["ch-1"], kind: "group" });
    expect(results).toEqual([
      { input: "ch-1", resolved: true, id: "ch-1", name: "general", note: undefined },
    ]);
  });

  it("resolves by case-insensitive name", async () => {
    mockChannelsResponse();
    const results = await resolveTargets({ cfg: makeCfg(), inputs: ["beach"], kind: "group" });
    expect(results).toEqual([
      { input: "beach", resolved: true, id: "ch-2", name: "Beach", note: undefined },
    ]);
  });

  it("returns resolved: false for unknown channel", async () => {
    mockChannelsResponse();
    const results = await resolveTargets({ cfg: makeCfg(), inputs: ["nope"], kind: "group" });
    expect(results).toEqual([
      { input: "nope", resolved: false, id: undefined, name: undefined, note: "channel not found" },
    ]);
  });

  it("returns note when guildId is missing", async () => {
    const results = await resolveTargets({
      cfg: makeCfg({ guildId: undefined }),
      inputs: ["ch-1"],
      kind: "group",
    });
    expect(results).toEqual([
      { input: "ch-1", resolved: false, note: "guildId not configured" },
    ]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("soft-fails when token is missing", async () => {
    const results = await resolveTargets({
      cfg: makeCfg({ token: undefined }),
      inputs: ["ch-1"],
      kind: "group",
    });
    expect(results).toEqual([
      { input: "ch-1", resolved: false, note: "cove: account 'default' missing token — set channels.cove.accounts.<id>.token" },
    ]);
  });

  it("soft-fails when getChannels throws", async () => {
    vi.useFakeTimers();
    // Fail all attempts (initial + 3 retries)
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const promise = resolveTargets({ cfg: makeCfg(), inputs: ["ch-1"], kind: "group" });
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }
    const results = await promise;
    vi.useRealTimers();
    expect(results).toEqual([
      { input: "ch-1", resolved: false, note: "failed to fetch channels: ECONNREFUSED" },
    ]);
  });
});

describe("resolver — user kind", () => {
  it("returns not supported", async () => {
    const results = await resolveTargets({ cfg: makeCfg(), inputs: ["user-1"], kind: "user" });
    expect(results).toEqual([
      { input: "user-1", resolved: false, note: "user target resolution not supported" },
    ]);
  });
});

function makeMultiAccountCfg() {
  return {
    channels: {
      cove: {
        baseUrl: "http://localhost:3400",
        guildId: "guild-1",
        accounts: {
          kagura: { token: "kagura-token", agentId: "kagura", agentName: "Kagura" },
          ruantang: { token: "ruantang-token", agentId: "ruantang", agentName: "软糖" },
        },
      },
    },
  };
}

describe("resolveAccount — multi-account", () => {
  it("produces distinct CoveAccount results for two accounts", () => {
    const cfg = makeMultiAccountCfg();
    const kaguraAccount = resolveAccount(cfg, "kagura");
    const ruantangAccount = resolveAccount(cfg, "ruantang");

    expect(kaguraAccount.token).toBe("kagura-token");
    expect(kaguraAccount.agentId).toBe("kagura");
    expect(kaguraAccount.agentName).toBe("Kagura");

    expect(ruantangAccount.token).toBe("ruantang-token");
    expect(ruantangAccount.agentId).toBe("ruantang");
    expect(ruantangAccount.agentName).toBe("软糖");
  });

  it("deep-merges root-level defaults with per-account overrides", () => {
    const cfg = {
      channels: {
        cove: {
          baseUrl: "http://localhost:3400",
          guildId: "guild-default",
          accounts: {
            test: {
              token: "test-token",
              agentId: "test-agent",
              guildId: "guild-override",
            },
          },
        },
      },
    };

    const account = resolveAccount(cfg, "test");
    expect(account.baseUrl).toBe("http://localhost:3400"); // from root
    expect(account.guildId).toBe("guild-override"); // from account
    expect(account.token).toBe("test-token");
    expect(account.agentId).toBe("test-agent");
  });

  it("uses defaultAccount when accountId is omitted", () => {
    const cfg = {
      channels: {
        cove: {
          baseUrl: "http://localhost:3400",
          guildId: "guild-1",
          defaultAccount: "ruantang",
          accounts: {
            kagura: { token: "kagura-token", agentId: "kagura" },
            ruantang: { token: "ruantang-token", agentId: "ruantang" },
          },
        },
      },
    };

    const account = resolveAccount(cfg, undefined);
    expect(account.token).toBe("ruantang-token");
    expect(account.agentId).toBe("ruantang");
  });

  it("resolver soft-fail forwards real error message", async () => {
    const cfg = {
      channels: {
        cove: {
          accounts: {
            broken: { agentId: "test" }, // missing token
          },
        },
      },
    };

    const results = await resolveTargets({
      cfg,
      accountId: "broken",
      inputs: ["ch-1"],
      kind: "group",
    });

    expect(results[0].resolved).toBe(false);
    expect(results[0].note).toContain("missing token");
    expect(results[0].note).toContain("channels.cove.accounts.<id>.token");
  });
});

describe('multi-account resolution', () => {
  function makeMultiAccountCfg(overrides = {}) {
    return {
      channels: {
        cove: {
          baseUrl: 'http://localhost:3400',
          guildId: 'guild-1',
          accounts: {
            kagura: { token: 'kagura-token', agentId: 'kagura', agentName: 'Kagura' },
            ruantang: { token: 'ruantang-token', agentId: 'ruantang', agentName: '软糖' },
          },
          ...overrides,
        },
      },
    };
  }

  it('resolves distinct accounts by accountId', () => {
    const cfg = makeMultiAccountCfg();
    const a = resolveAccount(cfg, 'kagura');
    const b = resolveAccount(cfg, 'ruantang');
    expect(a.token).toBe('kagura-token');
    expect(a.agentId).toBe('kagura');
    expect(b.token).toBe('ruantang-token');
    expect(b.agentId).toBe('ruantang');
  });

  it('deep-merges root-level defaults with per-account overrides', () => {
    const cfg = makeMultiAccountCfg();
    const a = resolveAccount(cfg, 'kagura');
    expect(a.baseUrl).toBe('http://localhost:3400');
    expect(a.guildId).toBe('guild-1');
  });

  it('uses defaultAccount when accountId is omitted', () => {
    const cfg = makeMultiAccountCfg({ defaultAccount: 'ruantang' });
    const a = resolveAccount(cfg);
    expect(a.agentId).toBe('ruantang');
    expect(a.token).toBe('ruantang-token');
  });

  it('throws with actionable message when token is missing', () => {
    const cfg = { channels: { cove: { accounts: { broken: { agentId: 'test' } } } } };
    expect(() => resolveAccount(cfg, 'broken')).toThrow(/missing token/);
    expect(() => resolveAccount(cfg, 'broken')).toThrow(/channels\.cove\.accounts/);
  });

  it('throws with actionable message when agentId is missing', () => {
    const cfg = { channels: { cove: { accounts: { broken: { token: 'tok' } } } } };
    expect(() => resolveAccount(cfg, 'broken')).toThrow(/missing agentId/);
    expect(() => resolveAccount(cfg, 'broken')).toThrow(/channels\.cove\.accounts/);
  });
});
