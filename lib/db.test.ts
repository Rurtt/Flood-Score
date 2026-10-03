import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("getDb", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("throws when env is missing", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_RPC_KEY", "");
    const { getDb } = await import("./db");
    expect(() => getDb()).toThrow("SUPABASE_URL and SUPABASE_RPC_KEY must be set");
  });

  it("returns a client when env is set", async () => {
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_RPC_KEY", "test-key");
    const { getDb } = await import("./db");
    expect(typeof getDb().rpc).toBe("function");
  });
});
