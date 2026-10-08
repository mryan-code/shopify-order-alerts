import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export function normalizePhone(
  input: string | null | undefined,
  defaultCountry: CountryCode = "US",
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
    if (!parsed?.isPossible()) return null;
    return parsed.number;
  } catch {
    return null;
  }
}

export function isCountryCode(value: string): value is CountryCode {
  return /^[A-Z]{2}$/.test(value);
}
