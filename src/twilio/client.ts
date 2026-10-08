import twilio, { type Twilio } from "twilio";
import { sayTwiml } from "./twiml.js";

export interface TwilioSender {
  sendSms(to: string, body: string): Promise<{ sid: string }>;
  call(to: string, body: string): Promise<{ sid: string }>;
}

export class TwilioSendError extends Error {
  readonly code: number | null;

  constructor(message: string, code: number | null) {
    super(message);
    this.name = "TwilioSendError";
    this.code = code;
  }
}

export function createTwilioSender(
  config: { accountSid: string; authToken: string; fromNumber: string },
  factory: (accountSid: string, authToken: string) => Twilio = (accountSid, authToken) =>
    twilio(accountSid, authToken),
): TwilioSender {
  const client = factory(config.accountSid, config.authToken);
  return {
    async sendSms(to, body) {
      try {
        const message = await client.messages.create({ to, from: config.fromNumber, body });
        return { sid: message.sid };
      } catch (error) {
        throw toSendError(error);
      }
    },
    async call(to, body) {
      try {
        const call = await client.calls.create({
          to,
          from: config.fromNumber,
          twiml: sayTwiml(body),
        });
        return { sid: call.sid };
      } catch (error) {
        throw toSendError(error);
      }
    },
  };
}

function toSendError(error: unknown): TwilioSendError {
  if (error instanceof TwilioSendError) return error;
  const code = typeof error === "object" && error && "code" in error ? Number(error.code) : null;
  const message = error instanceof Error ? error.message : "Twilio request failed";
  return new TwilioSendError(message, Number.isFinite(code) ? code : null);
}
