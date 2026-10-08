import { describe, expect, it } from "vitest";
import { classifyInbound } from "../src/domain/opt-out.js";

describe("classifyInbound", () => {
  it("recognizes Twilio opt-out, opt-in, help, and status keywords", () => {
    expect(classifyInbound(" stop ")).toBe("opt_out");
    expect(classifyInbound("Stop!")).toBe("opt_out");
    expect(classifyInbound("unsubscribe")).toBe("opt_out");
    expect(classifyInbound("CANCEL")).toBe("opt_out");
    expect(classifyInbound("start")).toBe("opt_in");
    expect(classifyInbound("UNSTOP")).toBe("opt_in");
    expect(classifyInbound("help")).toBe("help");
    expect(classifyInbound("Info.")).toBe("help");
    expect(classifyInbound("status")).toBe("status");
  });

  it("treats ordinary replies as conversation messages", () => {
    expect(classifyInbound("Where is my order?")).toBe("message");
    expect(classifyInbound("please stop by the store")).toBe("message");
  });
});
