import { describe, expect, it } from "vitest";
import { nextSendTime } from "../src/domain/quiet-hours.js";

const overnight = {
  quietHoursEnabled: true,
  quietHoursStart: "21:00",
  quietHoursEnd: "08:00",
  quietHoursTimezone: "America/New_York",
};

describe("nextSendTime", () => {
  it("keeps daytime sends immediate", () => {
    const now = new Date("2026-01-15T20:00:00-05:00");
    expect(nextSendTime(now, overnight).toISOString()).toBe(now.toISOString());
  });

  it("defers late evening and early morning sends until quiet hours end", () => {
    expect(nextSendTime(new Date("2026-01-15T22:00:00-05:00"), overnight).toISOString()).toBe(
      "2026-01-16T13:00:00.000Z",
    );
    expect(nextSendTime(new Date("2026-01-16T06:30:00-05:00"), overnight).toISOString()).toBe(
      "2026-01-16T13:00:00.000Z",
    );
  });

  it("treats the end minute as open and honors a disabled window", () => {
    const end = new Date("2026-01-16T08:00:00-05:00");
    expect(nextSendTime(end, overnight).toISOString()).toBe(end.toISOString());
    const night = new Date("2026-07-15T22:00:00-04:00");
    expect(nextSendTime(night, { ...overnight, quietHoursEnabled: false }).toISOString()).toBe(
      night.toISOString(),
    );
  });

  it("handles a same-day window", () => {
    const settings = { ...overnight, quietHoursStart: "09:00", quietHoursEnd: "17:00" };
    expect(nextSendTime(new Date("2026-01-15T10:15:00-05:00"), settings).toISOString()).toBe(
      "2026-01-15T22:00:00.000Z",
    );
  });
});
