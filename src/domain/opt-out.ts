export const GLOBAL_OPT_OUT_SHOP = "*";

export type InboundIntent = "opt_out" | "opt_in" | "help" | "status" | "message";

const OPT_OUT = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const OPT_IN = new Set(["START", "YES", "UNSTOP"]);
const HELP = new Set(["HELP", "INFO"]);

export function classifyInbound(body: string): InboundIntent {
  const keyword = body
    .trim()
    .toUpperCase()
    .replace(/[.!,]+$/g, "")
    .replace(/\s+/g, "");
  if (OPT_OUT.has(keyword)) return "opt_out";
  if (OPT_IN.has(keyword)) return "opt_in";
  if (HELP.has(keyword)) return "help";
  if (keyword === "STATUS") return "status";
  return "message";
}
