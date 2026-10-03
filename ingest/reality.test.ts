import { describe, expect, it } from "vitest";
import { spikeFailures, type DistrictRank } from "./reality.ts";
const good: DistrictRank[] = [
  { district: "ประเวศ", rank: 1 }, { district: "ลาดกระบัง", rank: 2 },
  { district: "หนองจอก", rank: 3 }, { district: "มีนบุรี", rank: 4 },
  { district: "บางเขน", rank: 9 }, { district: "บางนา", rank: 20 },
  { district: "ธนบุรี", rank: 45 },
];
describe("spikeFailures", () => {
  it("passes the spike ranking", () => { expect(spikeFailures(good)).toEqual([]); });
  it("flags each broken rule", () => {
    const bad = good.map((d) => d.district === "บางเขน" ? { ...d, rank: 16 } : d.district === "ธนบุรี" ? { ...d, rank: 35 } : d);
    expect(spikeFailures(bad)).toEqual(["บางเขน: rank 16, expected top 15", "ธนบุรี: rank 35, expected rank 36 or lower"]);
  });
  it("flags missing districts and an out-of-band middle", () => {
    const f = spikeFailures([...good.filter((d) => d.district !== "ประเวศ" && d.district !== "บางนา"), { district: "บางนา", rank: 5 }]);
    expect(f).toContain("ประเวศ: rank missing, expected top 15");
    expect(f).toContain("บางนา: rank 5, expected between 11 and 39");
  });
});
