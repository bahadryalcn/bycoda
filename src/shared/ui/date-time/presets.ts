import { addDays, type DateRange } from "./values";

export type DateRangePreset = { label: string; range: (today: Date) => DateRange };
export const defaultDateRangePresets: DateRangePreset[] = [
  { label: "Today", range: (today) => ({ start: today, end: today }) },
  {
    label: "Yesterday",
    range: (today) => ({ start: addDays(today, -1), end: addDays(today, -1) }),
  },
  { label: "Last 7 days", range: (today) => ({ start: addDays(today, -6), end: today }) },
  { label: "Last 30 days", range: (today) => ({ start: addDays(today, -29), end: today }) },
  {
    label: "This month",
    range: (today) => ({ start: new Date(today.getFullYear(), today.getMonth(), 1), end: today }),
  },
  {
    label: "Last month",
    range: (today) => ({
      start: new Date(today.getFullYear(), today.getMonth() - 1, 1),
      end: new Date(today.getFullYear(), today.getMonth(), 0),
    }),
  },
  {
    label: "This quarter",
    range: (today) => ({
      start: new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1),
      end: today,
    }),
  },
  {
    label: "Year to date",
    range: (today) => ({ start: new Date(today.getFullYear(), 0, 1), end: today }),
  },
];
