import { describe, expect, it } from "vitest";
import { renderTemplate } from "../src/domain/templates.js";

describe("renderTemplate", () => {
  it("replaces known variables and ignores surrounding whitespace", () => {
    const text = renderTemplate(
      "Hi {{ customer_first_name }}, {{order_name}} is {{ status_summary }}.",
      {
        customer_first_name: "Ada",
        order_name: "#1001",
        status_summary: "paid, not yet shipped",
      },
    );
    expect(text).toBe("Hi Ada, #1001 is paid, not yet shipped.");
  });

  it("renders missing values as empty and leaves unknown tokens in place", () => {
    const text = renderTemplate("Track {{tracking_number}} {{not_a_variable}}", {});
    expect(text).toBe("Track {{not_a_variable}}");
  });

  it("collapses gaps left by empty variables", () => {
    const text = renderTemplate("Via {{tracking_company}} number {{tracking_number}}", {
      tracking_number: "1Z999",
    });
    expect(text).toBe("Via number 1Z999");
  });
});
