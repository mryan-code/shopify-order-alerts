import { describe, expect, it } from "vitest";
import { defaultSettings, parseSettings } from "../src/domain/settings.js";

describe("settings", () => {
  it("accepts defaults and rejects an unknown time zone", () => {
    expect(parseSettings(defaultSettings()).stalledAfterDays).toBe(3);
    expect(() => parseSettings({ ...defaultSettings(), quietHoursTimezone: "Not/AZone" })).toThrow(
      /time zone/i,
    );
    expect(() => parseSettings({ ...defaultSettings(), stalledAfterDays: 0 })).toThrow();
  });
});
