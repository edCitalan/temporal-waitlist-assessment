import type { OpeningInput } from "./types";

/** Validate HTTP input and derive calendar fields once, outside workflow replay. */
export function normalizeOpening(body: unknown, now = Date.now()): OpeningInput {
  const value = body as Partial<OpeningInput> | null;
  if (!value || !["Haircut", "Color", "Highlights"].includes(value.service ?? "") ||
      !["Jules", "Rosa"].includes(value.stylist ?? "") ||
      typeof value.startsAt !== "string" || !/Z$|[+-]\d{2}:\d{2}$/.test(value.startsAt) ||
      !Number.isFinite(Date.parse(value.startsAt)) || Date.parse(value.startsAt) <= now ||
      typeof value.durationMinutes !== "number" || !Number.isInteger(value.durationMinutes) ||
      value.durationMinutes < 15 || value.durationMinutes > 480) {
    throw new Error("Choose a service, Jules or Rosa, a future appointment, and a length from 15 to 480 minutes.");
  }
  const startsAt = new Date(value.startsAt).toISOString();
  const responseMinutes = value.responseMinutes ?? 15;
  if (!Number.isSafeInteger(responseMinutes) || responseMinutes < 1 || responseMinutes > 1440) {
    throw new Error("Choose a reply window from 1 to 1440 whole minutes.");
  }
  const offerUntil = value.offerUntil || startsAt;
  if (typeof offerUntil !== "string" || !/Z$|[+-]\d{2}:\d{2}$/.test(offerUntil) ||
      !Number.isFinite(Date.parse(offerUntil)) || Date.parse(offerUntil) <= now || Date.parse(offerUntil) > Date.parse(startsAt)) {
    throw new Error("The last practical response time must be in the future and no later than the appointment.");
  }
  const timeZone = value.timeZone || "America/Los_Angeles";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(startsAt));
  } catch {
    throw new Error("Choose a valid salon time zone.");
  }
  const part = (kind: string) => parts.find((p) => p.type === kind)!.value;
  return {
    service: value.service!, stylist: value.stylist!, startsAt, durationMinutes: value.durationMinutes, responseMinutes,
    offerUntil: new Date(offerUntil).toISOString(), timeZone,
    localDay: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday")),
    localHour: Number(part("hour")),
    displayTime: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(startsAt)),
  };
}
