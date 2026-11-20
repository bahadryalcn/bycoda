export type InterjectionSeverity = "nit" | "concern" | "blocker";

export type InterjectionMeta = {
  customType: string;
  /** Highest severity among this interjection's retained notes, when any is known. */
  severity?: InterjectionSeverity;
};
