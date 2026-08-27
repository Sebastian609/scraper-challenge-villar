import type { DateRange } from "../types/scraper.interface.ts";

export function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function augustRange(): DateRange {
  const year = new Date().getFullYear();
  const start = new Date(year, 7, 1);
  const end = new Date(year, 7, 31);
  return { start: formatDate(start), end: formatDate(end) };
}
