import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient, type Db } from "./db.ts";
import { createStore } from "./store.ts";
import type { FloodRow } from "./traffy.ts";
const enabled = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
if (process.env.CI && !enabled) throw new Error("CI requires local Supabase integration credentials");
if (enabled) {
  const url = new URL(process.env.SUPABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Store tests refuse non-loopback Supabase URLs");
}
describe.skipIf(!enabled)("createStore (local Supabase)", () => {
  let db: Db;
  const runIds: number[] = [];
  const ids = [`task5-${randomUUID()}`, `task5-${randomUUID()}`];
  const row = (id: string, state: string): FloodRow => ({ source: "test", source_id: id, reported_at: "2026-09-15T22:44:31+07:00", finished_at: null, geom: "SRID=4326;POINT(100.65 13.65)", state });
  beforeAll(() => { db = serviceClient(); });
  afterAll(async () => {
    const { error } = await db.from("flood_reports").delete().eq("source", "test").in("source_id", ids);
    if (error) throw new Error(error.message);
    if (runIds.length) {
      const { error } = await db.from("ingest_runs").delete().in("id", runIds);
      if (error) throw new Error(error.message);
    }
  });
  it("refresh RPC is callable", async () => { await expect(createStore(db).refresh()).resolves.toBeUndefined(); });
  it("upserts idempotently and updates state", async () => {
    const store = createStore(db);
    await store.upsert(ids.map((id) => row(id, "รอรับเรื่อง")));
    await store.upsert([row(ids[0], "เสร็จสิ้น"), row(ids[1], "รอรับเรื่อง")]);
    const { data, error } = await db.from("flood_reports").select("source_id,state,reported_at").eq("source", "test").in("source_id", ids);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data?.find((r) => r.source_id === ids[0])?.state).toBe("เสร็จสิ้น");
    expect(new Date(data![0].reported_at).toISOString()).toBe("2026-09-15T15:44:31.000Z");
  });
  it("expires stale running rows on startRun", async () => {
    const old = await db.from("ingest_runs").insert({ source: "traffy", status: "running", started_at: new Date(Date.now() - 60 * 60_000).toISOString() }).select("id").single();
    expect(old.error).toBeNull();
    runIds.push(old.data!.id);
    runIds.push(await createStore(db).startRun({ start: "2026-10-01", end: "2026-10-03" }));
    const { data } = await db.from("ingest_runs").select("status,finished_at,error").eq("id", old.data!.id).single();
    expect(data).toMatchObject({ status: "failed", error: "stale: exceeded job timeout" });
    expect(data?.finished_at).not.toBeNull();
  });
  it("records run counts, Bangkok window and truncated error", async () => {
    const store = createStore(db);
    const id = await store.startRun({ start: "2026-10-01", end: "2026-10-03" });
    runIds.push(id);
    await store.finishRun(id, { status: "partial", rowsUpserted: 5, rowsRejected: 1, error: "x".repeat(5000) });
    const { data, error } = await db.from("ingest_runs").select("*").eq("id", id).single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ source: "traffy", status: "partial", rows_upserted: 5, rows_rejected: 1 });
    expect(data?.finished_at).not.toBeNull();
    expect(data?.error).toHaveLength(2000);
    expect(new Date(data!.window_start!).toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(new Date(data!.window_end!).toISOString()).toBe("2026-10-03T16:59:59.000Z");
  });
});
