import { describe, expect, it, vi } from "vitest";
import { runIngest, type Store } from "./pipeline.ts";
const w = { start: "2026-09-29", end: "2026-10-01" };
const feature = (id: number) => ({ geometry: { type: "Point", coordinates: [100.65, 13.7] }, properties: { ticket_id: `t${id}`, timestamp: "2026-09-15 22:44:31", state: "รอรับเรื่อง" } });
const many = (n: number) => Array.from({ length: n }, (_, i) => feature(i));
const bad = { geometry: null, properties: {} };
const traffy = (features: unknown[], total = features.length) => (async (input: string | URL | Request) => {
  const offset = Number(new URL(String(input)).searchParams.get("offset"));
  return Response.json({ status: "success", total, features: features.slice(offset, offset + 1000) });
}) as typeof fetch;
const fakeStore = (over: Partial<Store> = {}): Store => ({ startRun: vi.fn(async () => 7), upsert: vi.fn(async () => {}), refresh: vi.fn(async () => {}), finishRun: vi.fn(async () => {}), ...over });
describe("runIngest", () => {
  it("batches 1200 paginated rows and closes an ok run", async () => {
    const store = fakeStore();
    const r = await runIngest(store, w, { fetchFn: traffy(many(1200)) });
    expect(vi.mocked(store.upsert).mock.calls.map(([rows]) => rows.length)).toEqual([500, 500, 200]);
    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ status: "ok", rowsUpserted: 1200, rowsRejected: 0, error: null });
    expect(store.startRun).toHaveBeenCalledWith(w);
    expect(store.finishRun).toHaveBeenCalledExactlyOnceWith(7, r);
  });
  it("rejects over 20% before writing", async () => {
    const store = fakeStore();
    const r = await runIngest(store, w, { fetchFn: traffy([...many(7), bad, bad, bad]) });
    expect(r).toMatchObject({ status: "failed", rowsUpserted: 0, rowsRejected: 3 });
    expect(r.error).toContain("20%");
    expect(store.upsert).not.toHaveBeenCalled();
    expect(store.refresh).not.toHaveBeenCalled();
    expect(store.finishRun).toHaveBeenCalledExactlyOnceWith(7, r);
  });
  it("writes exactly 20% rejected", async () => {
    expect(await runIngest(fakeStore(), w, { fetchFn: traffy([...many(8), bad, bad]) })).toMatchObject({ status: "ok", rowsUpserted: 8, rowsRejected: 2 });
  });
  it("writes a partial response", async () => {
    const r = await runIngest(fakeStore(), w, { fetchFn: traffy(many(5), 6) });
    expect(r).toMatchObject({ status: "partial", rowsUpserted: 5 });
    expect(r.error).toContain("6");
  });
  it("empty response skips refresh", async () => {
    const store = fakeStore();
    expect(await runIngest(store, w, { fetchFn: traffy([]) })).toEqual({ status: "ok", rowsUpserted: 0, rowsRejected: 0, error: null });
    expect(store.refresh).not.toHaveBeenCalled();
  });
  it("closes a failed fetch", async () => {
    const store = fakeStore();
    const fetchFn = vi.fn(async () => { throw new Error("ETIMEDOUT"); });
    const r = await runIngest(store, w, { fetchFn, retryDelayMs: 0 });
    expect(r).toEqual({ status: "failed", rowsUpserted: 0, rowsRejected: 0, error: "Traffy fetch failed after 4 attempts" });
    expect(store.finishRun).toHaveBeenCalledExactlyOnceWith(7, r);
  });
  it("counts only successful batches and preserves rejections on failure", async () => {
    let calls = 0;
    const store = fakeStore({ upsert: vi.fn(async () => { if (++calls === 2) throw new Error("connection refused"); }) });
    const r = await runIngest(store, w, { fetchFn: traffy([...many(1200), bad]) });
    expect(r).toEqual({ status: "failed", rowsUpserted: 500, rowsRejected: 1, error: "connection refused" });
    expect(store.refresh).not.toHaveBeenCalled();
    expect(store.finishRun).toHaveBeenCalledExactlyOnceWith(7, r);
  });
  it("refresh failure retains all written counts", async () => {
    const store = fakeStore({ refresh: vi.fn(async () => { throw new Error("refresh failed"); }) });
    const r = await runIngest(store, w, { fetchFn: traffy([...many(8), bad]) });
    expect(r).toEqual({ status: "failed", rowsUpserted: 8, rowsRejected: 1, error: "refresh failed" });
    expect(store.finishRun).toHaveBeenCalledExactlyOnceWith(7, r);
  });
  it("propagates start failure without fetching or finishing", async () => {
    const store = fakeStore({ startRun: vi.fn(async () => { throw new Error("start failed"); }) });
    const fetchFn = vi.fn(traffy([]));
    await expect(runIngest(store, w, { fetchFn })).rejects.toThrow("start failed");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(store.finishRun).not.toHaveBeenCalled();
  });
  it("propagates finish failure", async () => {
    const store = fakeStore({ finishRun: vi.fn(async () => { throw new Error("finish failed"); }) });
    await expect(runIngest(store, w, { fetchFn: traffy([]) })).rejects.toThrow("finish failed");
    expect(store.finishRun).toHaveBeenCalledTimes(1);
  });
});
