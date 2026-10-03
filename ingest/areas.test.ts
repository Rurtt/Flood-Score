import { describe, expect, it } from "vitest";
import { toArea, type OsmRelation } from "./areas.ts";

const rel = (tags: Record<string, string>): OsmRelation => ({
  tags,
  members: [
    { type: "way", role: "outer", geometry: [{ lat: 13.1234567, lon: 100.7654321 }, { lat: 13.2, lon: 100.8 }] },
    { type: "way", role: "admin_centre", geometry: [{ lat: 1, lon: 1 }] },
    { type: "node", role: "label" },
  ],
});

describe("toArea", () => {
  it("maps a khet relation", () => {
    expect(toArea(rel({ admin_level: "6", "name:th": "เขตประเวศ", "short_name:en": "Prawet" }))).toEqual({
      level: "district", name_th: "ประเวศ", name_en: "Prawet", ways: [[[100.765432, 13.123457], [100.8, 13.2]]],
    });
  });
  it("maps a khwaeng and falls back to name / name:en", () => {
    const a = toArea(rel({ admin_level: "8", name: "แขวง คลองขวาง", "name:en": "Khlong Khwang Subdistrict" }));
    expect(a.level).toBe("subdistrict");
    expect(a.name_th).toBe("คลองขวาง");
    expect(a.name_en).toBe("Khlong Khwang");
  });
  it("strips the District suffix", () => {
    expect(toArea(rel({ admin_level: "6", name: "เขตบางรัก", "name:en": "Bang Rak District" })).name_en).toBe("Bang Rak");
  });
  it("keeps only outer ways", () => {
    expect(toArea(rel({ admin_level: "6", name: "เขตก" })).ways).toHaveLength(1);
  });
  it("allows absent English names", () => {
    expect(toArea(rel({ admin_level: "6", name: "เขตก" })).name_en).toBeNull();
  });
  it("rejects unsupported levels", () => {
    expect(() => toArea(rel({ admin_level: "4", name: "ก" }))).toThrow("Unsupported admin_level");
  });
  it.each<Record<string, string>>([{}, { name: "แขวง " }])("rejects absent or empty Thai names", (tags) => {
    expect(() => toArea(rel({ admin_level: "8", ...tags }))).toThrow("Missing Thai name");
  });
  it.each([NaN, Infinity, -Infinity])("rejects non-finite coordinates", (lat) => {
    const r = rel({ admin_level: "6", name: "ก" });
    r.members[0].geometry![0].lat = lat;
    expect(() => toArea(r)).toThrow("Invalid outer geometry");
  });
  it.each([undefined, []])("rejects missing or empty outer geometry", (geometry) => {
    const r = rel({ admin_level: "6", name: "ก" });
    r.members[0].geometry = geometry;
    expect(() => toArea(r)).toThrow("Invalid outer geometry");
  });
  it("rejects relations without outer ways", () => {
    expect(() => toArea({ tags: { admin_level: "6", name: "ก" }, members: [] })).toThrow("Missing outer ways");
  });
});
