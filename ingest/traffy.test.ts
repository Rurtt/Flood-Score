import { describe, expect, it, vi } from "vitest";
import { bangkokDate, bangkokToIso, fetchTraffy, PAGE_SIZE, toRow } from "./traffy.ts";

const feature = (id: string, over: Record<string, unknown> = {}, coords = [100.62131, 13.84481]) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: coords },
  properties: {
    ticket_id: id,
    timestamp: "2026-09-15 22:44:31",
    timestamp_finished: "2026-09-16 10:17:31",
    state: "เสร็จสิ้น",
    description: "reporter text that must never be stored",
    photo_url: "https://example.com/p.jpg",
    ...over,
  },
});

describe("bangkokToIso", () => {
  it("adds the Bangkok offset", () => {
    expect(bangkokToIso("2026-09-15 22:44:31")).toBe("2026-09-15T22:44:31+07:00");
  });
  it("Bangkok offset: 00:30 on 1 Oct is 30 Sep in UTC", () => {
    expect(new Date(bangkokToIso("2026-10-01 00:30:00")!).toISOString()).toBe("2026-09-30T17:30:00.000Z");
  });
  it("impossible date rejected", () => {
    expect(bangkokToIso("2026-02-30 10:00:00")).toBeNull();
    expect(bangkokToIso("2026-13-01 10:00:00")).toBeNull();
    expect(bangkokToIso("yesterday")).toBeNull();
  });
});

describe("bangkokDate", () => {
  it("uses the Bangkok calendar day", () => {
    expect(bangkokDate(new Date("2026-10-02T17:30:00Z"))).toBe("2026-10-03");
    expect(bangkokDate(new Date("2026-10-02T16:59:59Z"))).toBe("2026-10-02");
  });
});

describe("toRow", () => {
  it("maps only the allowed fields", () => {
    expect(toRow(feature("2026-YNWKCE"))).toEqual({
      source: "traffy",
      source_id: "2026-YNWKCE",
      reported_at: "2026-09-15T22:44:31+07:00",
      finished_at: "2026-09-16T10:17:31+07:00",
      geom: "SRID=4326;POINT(100.62131 13.84481)",
      state: "เสร็จสิ้น",
    });
  });
  it("allows missing finish time and state", () => {
    const r = toRow(feature("a", { timestamp_finished: null, state: null }));
    expect(r?.finished_at).toBeNull();
    expect(r?.state).toBeNull();
  });
  it("rejects bad features", () => {
    expect(toRow(feature(""))).toBeNull(); // empty ticket id
    expect(toRow(feature("a", { timestamp: "2026-02-30 10:00:00" }))).toBeNull(); // impossible date
    expect(toRow(feature("a", {}, [100.2, 13.7]))).toBeNull(); // west of Bangkok bounds
    expect(toRow(feature("a", {}, [Number.NaN, 13.7]))).toBeNull();
    expect(toRow({ type: "Feature", geometry: null, properties: {} })).toBeNull();
    expect(toRow("junk")).toBeNull();
  });
});

type Page = { status: string; total?: number; features?: unknown[] };
const fakeFetch = (pages: (Page | Error)[]) =>
  vi.fn(async () => {
    const next = pages.shift();
    if (!next) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return Response.json(next);
  });
const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => feature(`t${from + i}`));
const w = { start: "2026-09-29", end: "2026-10-01" };

describe("fetchTraffy", () => {
  it("pages with limit/offset until total, encodes the Thai problem type", async () => {
    const fn = fakeFetch([
      { status: "success", total: 2500, features: ids(0, PAGE_SIZE) },
      { status: "success", total: 2500, features: ids(1000, PAGE_SIZE) },
      { status: "success", total: 2500, features: ids(2000, 500) },
    ]);
    const r = await fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch });
    expect(r).toMatchObject({ rejected: 0, total: 2500, complete: true });
    expect(r.rows).toHaveLength(2500);
    const urls = fn.mock.calls.map((c) => new URL(String((c as unknown[])[0])));
    expect(urls.map((u) => u.searchParams.get("offset"))).toEqual(["0", "1000", "2000"]);
    expect(urls[0].searchParams.get("problem_type")).toBe("น้ำท่วม");
    expect(urls[0].searchParams.get("limit")).toBe("1000");
    expect(urls[0].searchParams.get("start")).toBe("2026-09-29");
    expect(urls[0].searchParams.get("end")).toBe("2026-10-01");
  });

  it("duplicate across pages is stored once", async () => {
    const fn = fakeFetch([
      { status: "success", total: 1001, features: ids(0, PAGE_SIZE) },
      { status: "success", total: 1001, features: [feature("t999")] }, // shifted by a new report
    ]);
    const r = await fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch });
    expect(r.rows).toHaveLength(1000);
    expect(r.complete).toBe(false); // 1000 unique < 1001 reported
  });

  it("counts rejected features", async () => {
    const fn = fakeFetch([{ status: "success", total: 3, features: [feature("a"), feature(""), "junk"] }]);
    const r = await fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch });
    expect(r).toMatchObject({ rejected: 2, total: 3, complete: true });
    expect(r.rows).toHaveLength(1);
  });

  it("empty window is complete", async () => {
    const fn = fakeFetch([{ status: "success", total: 0, features: [] }]);
    expect(await fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch })).toEqual({ rows: [], rejected: 0, total: 0, complete: true });
  });

  it("retries then succeeds", async () => {
    const fn = fakeFetch([new Error("ECONNRESET"), { status: "success", total: 1, features: [feature("a")] }]);
    const r = await fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch, retryDelayMs: 0 });
    expect(r.rows).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("status fail is an error after 1 + 3 attempts", async () => {
    const fail = { status: "fail" };
    const fn = fakeFetch([fail, fail, fail, fail]);
    await expect(fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch, retryDelayMs: 0 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(4);
  });
});

describe("Traffy validation and retry boundaries", () => {
  it("rejects invalid non-null finish timestamps and impossible calendar times", () => {
    for (const timestamp_finished of ["", "2026-02-30 10:00:00", "private reporter text"])
      expect(toRow(feature("a", { timestamp_finished }))).toBeNull();
    for (const ts of ["2025-02-29 10:00:00", "2026-04-31 10:00:00", "2026-09-15 24:00:00", "2026-09-15 10:60:00"])
      expect(bangkokToIso(ts)).toBeNull();
    expect(bangkokToIso("2024-02-29 10:00:00")).toBe("2024-02-29T10:00:00+07:00");
  });

  it("drops all private properties and feature fields", () => {
    const row = toRow({ ...feature("a", { address: "secret address", reporter: "secret person" }), private: "secret" });
    expect(Object.keys(row!).sort()).toEqual(["finished_at", "geom", "reported_at", "source", "source_id", "state"]);
    expect(JSON.stringify(row)).not.toMatch(/secret|reporter text|example.com/);
  });

  it("deduplicates rejected ticket IDs across shifted pages", async () => {
    const bad = feature("bad", { timestamp_finished: "invalid" });
    const fn = fakeFetch([
      { status: "success", total: 1001, features: [...ids(0, 999), bad] },
      { status: "success", total: 1001, features: [bad] },
    ]);
    expect(await fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch })).toMatchObject({ rejected: 1, complete: false });
  });

  it.each(["HTTP", "JSON", "status"])("retries a %s failure and succeeds", async (kind) => {
    const fn = vi.fn().mockResolvedValueOnce(kind === "HTTP" ? new Response("private", { status: 500 }) : kind === "JSON" ? new Response("private invalid JSON") : Response.json({ status: "fail" }))
      .mockResolvedValueOnce(Response.json({ status: "success", total: 0, features: [] }));
    expect(await fetchTraffy(w, { fetchFn: fn, retryDelayMs: 0 })).toMatchObject({ complete: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized envelopes and exposes no schema or feature values", async () => {
    const fn = vi.fn(async () => Response.json({ status: "private reporter text", total: 1001, features: ids(0, 1001) }));
    await expect(fetchTraffy(w, { fetchFn: fn, retryDelayMs: 0 })).rejects.toThrow("Traffy fetch failed after 4 attempts");
    expect(fn).toHaveBeenCalledTimes(4);
    const oversized = vi.fn(async () => Response.json({ status: "success", total: 1001, features: ids(0, 1001) }));
    await expect(fetchTraffy(w, { fetchFn: oversized, retryDelayMs: 0 })).rejects.toThrow();
    expect(oversized).toHaveBeenCalledTimes(4);
  });

  it("uses exact 120-second abort signals and 1/2/4-second default backoff", async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const fn = fakeFetch([new Error("one"), new Error("two"), new Error("three"), { status: "success", total: 0, features: [] }]);
      const pending = fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch });
      await vi.advanceTimersByTimeAsync(999);
      expect(fn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fn).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1999);
      expect(fn).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(fn).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(3999);
      expect(fn).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(fn).toHaveBeenCalledTimes(4);
      expect(timeout.mock.calls).toEqual([[120000], [120000], [120000], [120000]]);
    } finally {
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });
});
