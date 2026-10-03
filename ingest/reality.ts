// Fixed bands from the 2026-10-02 spike. Investigate data before changing a band.
export type DistrictRank = { district: string; rank: number };
const HIGH = ["ประเวศ", "ลาดกระบัง", "มีนบุรี", "หนองจอก", "บางเขน"];
export function spikeFailures(districts: DistrictRank[]): string[] {
  const ranks = new Map(districts.map((d) => [d.district, d.rank]));
  const failures: string[] = [];
  const need = (name: string, ok: (rank: number) => boolean, rule: string) => {
    const rank = ranks.get(name);
    if (rank === undefined || !ok(rank)) failures.push(`${name}: rank ${rank ?? "missing"}, expected ${rule}`);
  };
  for (const name of HIGH) need(name, (rank) => rank <= 15, "top 15");
  need("ธนบุรี", (rank) => rank >= 36, "rank 36 or lower");
  need("บางนา", (rank) => rank > 10 && rank < 40, "between 11 and 39");
  return failures;
}
