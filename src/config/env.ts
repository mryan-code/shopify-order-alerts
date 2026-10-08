export type NodeEnv = "development" | "test" | "production";

export interface Env {
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  SCOPES: string[];
  SHOPIFY_APP_URL: string;
  SHOPIFY_API_VERSION: string;
  PORT: number;
  HOST: string;
  NODE_ENV: NodeEnv;
  DATABASE_URL: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_FROM_NUMBER: string;
  TWILIO_ADVANCED_OPT_OUT: boolean;
  ALLOW_DEV_ADMIN: boolean;
  WORKER_POLL_MS: number;
  STALLED_SCAN_MS: number;
  DEFAULT_PHONE_COUNTRY: string;
}

const REQUIRED = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SCOPES",
  "SHOPIFY_APP_URL",
  "DATABASE_URL",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
] as const;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const missing = REQUIRED.filter((key) => !source[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      [
        "Missing required environment variables:",
        ...missing.map((key) => `  - ${key}`),
        "Copy .sample.env to .env and set every value.",
      ].join("\n"),
    );
  }

  const errors: string[] = [];
  const appUrl = required(source, "SHOPIFY_APP_URL");
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(appUrl);
  } catch {
    errors.push(
      "SHOPIFY_APP_URL must be an absolute URL, for example https://your-tunnel.example.com",
    );
  }
  if (parsedUrl && parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    errors.push("SHOPIFY_APP_URL must use http or https");
  }

  const fromNumber = required(source, "TWILIO_FROM_NUMBER");
  if (!/^\+[1-9]\d{7,14}$/.test(fromNumber)) {
    errors.push("TWILIO_FROM_NUMBER must be E.164, for example +15555550100");
  }
  const accountSid = required(source, "TWILIO_ACCOUNT_SID");
  if (!accountSid.startsWith("AC")) {
    errors.push("TWILIO_ACCOUNT_SID must be a Twilio Account SID starting with AC");
  }

  const nodeEnv = optional(source, "NODE_ENV", "development");
  if (nodeEnv !== "development" && nodeEnv !== "test" && nodeEnv !== "production") {
    errors.push("NODE_ENV must be development, test, or production");
  }

  const port = parseInteger(optional(source, "PORT", "3000"), "PORT", errors);
  if (port !== null && (port < 1 || port > 65535)) errors.push("PORT must be between 1 and 65535");

  const workerPoll = parseInteger(
    optional(source, "WORKER_POLL_MS", "5000"),
    "WORKER_POLL_MS",
    errors,
  );
  const stalledScan = parseInteger(
    optional(source, "STALLED_SCAN_MS", "3600000"),
    "STALLED_SCAN_MS",
    errors,
  );
  const country = optional(source, "DEFAULT_PHONE_COUNTRY", "US");
  if (!/^[A-Z]{2}$/.test(country)) {
    errors.push("DEFAULT_PHONE_COUNTRY must be a two-letter region code such as US");
  }

  const scopes = required(source, "SCOPES")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (scopes.length === 0) errors.push("SCOPES must list at least one Admin API scope");

  if (errors.length > 0 || port === null || workerPoll === null || stalledScan === null) {
    throw new Error(
      ["Invalid environment variables:", ...errors.map((error) => `  - ${error}`)].join("\n"),
    );
  }

  return {
    SHOPIFY_API_KEY: required(source, "SHOPIFY_API_KEY"),
    SHOPIFY_API_SECRET: required(source, "SHOPIFY_API_SECRET"),
    SCOPES: scopes,
    SHOPIFY_APP_URL: appUrl.replace(/\/$/, ""),
    SHOPIFY_API_VERSION: optional(source, "SHOPIFY_API_VERSION", "2026-01"),
    PORT: port,
    HOST: optional(source, "HOST", "0.0.0.0"),
    NODE_ENV: nodeEnv as NodeEnv,
    DATABASE_URL: required(source, "DATABASE_URL"),
    TWILIO_ACCOUNT_SID: required(source, "TWILIO_ACCOUNT_SID"),
    TWILIO_AUTH_TOKEN: required(source, "TWILIO_AUTH_TOKEN"),
    TWILIO_FROM_NUMBER: fromNumber,
    TWILIO_ADVANCED_OPT_OUT: parseBoolean(optional(source, "TWILIO_ADVANCED_OPT_OUT", "false")),
    ALLOW_DEV_ADMIN: parseBoolean(optional(source, "ALLOW_DEV_ADMIN", "false")),
    WORKER_POLL_MS: workerPoll,
    STALLED_SCAN_MS: stalledScan,
    DEFAULT_PHONE_COUNTRY: country,
  };
}

function required(source: NodeJS.ProcessEnv, key: string): string {
  return source[key]?.trim() ?? "";
}

function optional(source: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = source[key]?.trim();
  return value ? value : fallback;
}

function parseInteger(value: string, key: string, errors: string[]): number | null {
  if (!/^\d+$/.test(value)) {
    errors.push(`${key} must be a positive integer`);
    return null;
  }
  return Number(value);
}

function parseBoolean(value: string): boolean {
  return value === "true" || value === "1";
}
