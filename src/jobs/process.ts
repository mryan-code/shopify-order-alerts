import type { Store } from "../db/types.js";
import { nextSendTime } from "../domain/quiet-hours.js";
import type { Logger } from "../logger.js";
import { TwilioSendError, type TwilioSender } from "../twilio/client.js";

const BACKOFF_CAP_MS = 15 * 60 * 1000;

export function retryDelayMs(attemptsAfterFailure: number): number {
  return Math.min(60_000 * 2 ** Math.max(attemptsAfterFailure - 1, 0), BACKOFF_CAP_MS);
}

export async function processDueJobs(
  deps: { store: Store; twilio: TwilioSender; now: () => Date; logger: Logger },
  limit = 25,
): Promise<{ sent: number; failed: number; suppressed: number }> {
  const jobs = await deps.store.claimDue(deps.now(), limit);
  const counts = { sent: 0, failed: 0, suppressed: 0 };
  for (const job of jobs) {
    const shop = await deps.store.getShop(job.shop);
    if (shop && !shop.installed) {
      await deps.store.markJobSuppressed(job.id, "Shop is uninstalled");
      counts.suppressed += 1;
      continue;
    }
    if (await deps.store.isOptedOut(job.shop, job.toPhone)) {
      await deps.store.markJobSuppressed(job.id, "Customer is opted out");
      await deps.store.addMessage(
        {
          shop: job.shop,
          shopifyOrderId: job.shopifyOrderId,
          direction: "outbound",
          channel: job.channel,
          body: job.body,
          status: "suppressed",
          eventType: job.eventType,
          toPhone: job.toPhone,
        },
        deps.now(),
      );
      counts.suppressed += 1;
      continue;
    }

    const settings = await deps.store.getSettings(job.shop);
    const sendAt = nextSendTime(deps.now(), settings);
    if (sendAt.getTime() > deps.now().getTime() + 1000) {
      await deps.store.rescheduleJob(job.id, sendAt);
      continue;
    }

    try {
      const result =
        job.channel === "voice"
          ? await deps.twilio.call(job.toPhone, job.body)
          : await deps.twilio.sendSms(job.toPhone, job.body);
      await deps.store.markJobSent(job.id, result.sid);
      await deps.store.addMessage(
        {
          shop: job.shop,
          shopifyOrderId: job.shopifyOrderId,
          direction: "outbound",
          channel: job.channel,
          body: job.body,
          status: "sent",
          twilioSid: result.sid,
          eventType: job.eventType,
          toPhone: job.toPhone,
        },
        deps.now(),
      );
      counts.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Send failed";
      if (error instanceof TwilioSendError && error.code === 21610) {
        await deps.store.optOut(job.shop, job.toPhone, deps.now());
        await deps.store.markJobSuppressed(job.id, "Carrier opt-out");
        counts.suppressed += 1;
        continue;
      }
      if (job.attempts + 1 >= job.maxAttempts) {
        await deps.store.markJobFailed(job.id, message);
        await deps.store.addMessage(
          {
            shop: job.shop,
            shopifyOrderId: job.shopifyOrderId,
            direction: "outbound",
            channel: job.channel,
            body: job.body,
            status: "failed",
            eventType: job.eventType,
            toPhone: job.toPhone,
          },
          deps.now(),
        );
        deps.logger.error("outbound send failed", {
          jobId: job.id,
          shop: job.shop,
          event: job.eventType,
        });
        counts.failed += 1;
      } else {
        const next = new Date(deps.now().getTime() + retryDelayMs(job.attempts + 1));
        await deps.store.markJobRetry(job.id, message, next);
        deps.logger.warn("outbound send will retry", { jobId: job.id, shop: job.shop });
      }
    }
  }
  return counts;
}
