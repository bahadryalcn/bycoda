import { t } from "../../../shared/i18n";

export const GRACE_OPTIONS = [
  {
    value: "0",
    get label() {
      return t("Do not catch up");
    },
  },
  {
    value: "30",
    get label() {
      return t("30 minutes");
    },
  },
  {
    value: "120",
    get label() {
      return t("2 hours");
    },
  },
  {
    value: "720",
    get label() {
      return t("12 hours");
    },
  },
  {
    value: "1440",
    get label() {
      return t("24 hours");
    },
  },
] as const;

export const RUN_TIME_LIMIT_OPTIONS = [
  {
    value: "0",
    get label() {
      return t("Default run time limit");
    },
  },
  {
    value: "15",
    get label() {
      return t("15 minutes");
    },
  },
  {
    value: "30",
    get label() {
      return t("30 minutes");
    },
  },
  {
    value: "60",
    get label() {
      return t("1 hour");
    },
  },
  {
    value: "120",
    get label() {
      return t("2 hours");
    },
  },
  {
    value: "240",
    get label() {
      return t("4 hours");
    },
  },
  {
    value: "480",
    get label() {
      return t("8 hours");
    },
  },
] as const;

export const RUNS_PER_DAY_OPTIONS = [
  {
    value: "0",
    get label() {
      return t("No limit");
    },
  },
  { value: "1", label: "1" },
  { value: "3", label: "3" },
  { value: "5", label: "5" },
  { value: "10", label: "10" },
  { value: "20", label: "20" },
] as const;

export function optionLabel(
  options: readonly { value: string; label: string }[],
  value: number,
): string {
  return options.find((option) => option.value === String(value))?.label ?? String(value);
}
