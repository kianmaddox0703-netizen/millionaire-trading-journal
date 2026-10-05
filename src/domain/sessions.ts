/**
 * Trading session from a timestamp, using each market's local business hours so
 * daylight-saving shifts are handled by the tz database:
 *   Sydney   07:00–16:00 Australia/Sydney
 *   Tokyo    09:00–18:00 Asia/Tokyo
 *   London   08:00–17:00 Europe/London
 *   New York 08:00–17:00 America/New_York
 * When London and New York are both open the session is "London/NY overlap".
 * If several Asian markets are open, Tokyo wins over Sydney.
 */
export const SESSIONS = ["Sydney", "Tokyo", "London", "London/NY overlap", "New York", "Off-hours"] as const;
export type Session = (typeof SESSIONS)[number];

function localHour(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")!.value) % 24;
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  const wd = parts.find((p) => p.type === "weekday")!.value;
  return { h: h + m / 60, weekend: wd === "Sat" || wd === "Sun" };
}

const open = (d: Date, tz: string, from: number, to: number) => {
  const { h, weekend } = localHour(d, tz);
  return !weekend && h >= from && h < to;
};

export function sessionOf(date: Date | number): Session {
  const d = typeof date === "number" ? new Date(date) : date;
  const london = open(d, "Europe/London", 8, 17);
  const ny = open(d, "America/New_York", 8, 17);
  if (london && ny) return "London/NY overlap";
  if (london) return "London";
  if (ny) return "New York";
  if (open(d, "Asia/Tokyo", 9, 18)) return "Tokyo";
  if (open(d, "Australia/Sydney", 7, 16)) return "Sydney";
  return "Off-hours";
}

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function dayOfWeek(date: Date | number, timeZone: string) {
  const d = typeof date === "number" ? new Date(date) : date;
  const wd = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(d);
  return DAYS.indexOf(wd as (typeof DAYS)[number]);
}

/** YYYY-MM-DD of a date in a timezone. */
export function ymd(date: Date | number, timeZone: string) {
  const d = typeof date === "number" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Monday (YYYY-MM-DD) of the ISO week containing a YYYY-MM-DD day. */
export function weekStartOf(day: string) {
  const d = new Date(day + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
