export type Area = {
  level: "district" | "subdistrict";
  name_th: string;
  name_en: string | null;
  ways: [number, number][][]; // GeoJSON order: [lng, lat]
};

export type OsmRelation = {
  tags: Record<string, string>;
  members: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
};

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function toArea(r: OsmRelation): Area {
  const t = r.tags;
  if (t.admin_level !== "6" && t.admin_level !== "8") throw new Error("Unsupported admin_level");
  const name = t["name:th"] ?? t.name;
  const name_th = name?.replace(/^(เขต|แขวง)\s*/, "").trim();
  if (!name_th) throw new Error("Missing Thai name");
  const outer = r.members.filter((m) => m.type === "way" && m.role === "outer");
  if (!outer.length) throw new Error("Missing outer ways");
  const ways = outer.map((m) => {
    if (!m.geometry || m.geometry.length < 2) throw new Error("Invalid outer geometry");
    return m.geometry.map((p): [number, number] => {
      if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat) || Math.abs(p.lon) > 180 || Math.abs(p.lat) > 90) {
        throw new Error("Invalid outer geometry");
      }
      return [round6(p.lon), round6(p.lat)];
    });
  });
  return {
    level: t.admin_level === "6" ? "district" : "subdistrict",
    name_th,
    name_en: (t["short_name:en"] ?? t["name:en"] ?? "").trim().replace(/ (District|Subdistrict)$/, "") || null,
    ways,
  };
}
