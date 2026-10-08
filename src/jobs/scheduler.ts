import type { Logger } from "../logger.js";
import { processDueJobs } from "./process.js";
import { scanStalledOrders } from "../services/stalled.js";
import type { ServiceDeps } from "../services/notifications.js";
import type { TwilioSender } from "../twilio/client.js";

export function startSchedulers(
  deps: ServiceDeps & { twilio: TwilioSender },
  intervals: { pollMs: number; stalledMs: number },
): () => void {
  let stopped = false;
  const runJobs = () => {
    if (stopped) return;
    void processDueJobs(deps).catch((error: unknown) => {
      deps.logger.error("send worker failed", { error: message(error) });
    });
  };
  const runScan = () => {
    if (stopped) return;
    void scanStalledOrders(deps).catch((error: unknown) => {
      deps.logger.error("stalled scan failed", { error: message(error) });
    });
  };
  void deps.store.releaseStuckJobs().catch((error: unknown) => {
    deps.logger.error("could not release stuck jobs", { error: message(error) });
  });
  const poll = setInterval(runJobs, intervals.pollMs);
  const stalled = setInterval(runScan, intervals.stalledMs);
  runJobs();
  runScan();
  return () => {
    stopped = true;
    clearInterval(poll);
    clearInterval(stalled);
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "error";
}

export type { Logger };
