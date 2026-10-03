import { describe, expect, it } from "vitest";
import { BANGKOK_BOUNDS, inBangkok, roundToGrid } from "./bangkok";

describe("inBangkok", () => {
  it("accepts Prawet", () => expect(inBangkok(13.7167, 100.695)).toBe(true));
  it("rejects Rangsit", () => expect(inBangkok(14.03, 100.62)).toBe(false));
  it("accepts the exact edge", () =>
    expect(inBangkok(BANGKOK_BOUNDS.minLat, BANGKOK_BOUNDS.minLng)).toBe(true));
  it("rejects NaN", () => expect(inBangkok(Number.NaN, 100.6)).toBe(false));
});

describe("roundToGrid", () => {
  it("puts points 10 m apart in the same cell", () => {
    expect(roundToGrid(13.71651, 100.69501)).toEqual(roundToGrid(13.71659, 100.69509));
  });
  it("snaps to the 0.0005 grid", () => {
    const { lat, lng } = roundToGrid(13.716789, 100.695123);
    expect(lat).toBe(13.717);
    expect(lng).toBe(100.695);
  });
});
