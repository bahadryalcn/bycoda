/** Local briefing cycle, including the previous calendar day before its boundary. */
export function chiefBriefingCycle(now: number, time = "09:00") {
  const date = new Date(now);
  const valid = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "09:00";
  const [hour, minute] = valid.split(":").map(Number);
  const boundary = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
  if (date < boundary) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function chiefContextLimits(policy: { soft: number; hard: number }, window?: number) {
  const hard =
    Number.isSafeInteger(window) && window! > 0
      ? Math.min(policy.hard, Math.floor(window! * 0.8))
      : policy.hard;
  return { hard, soft: Math.min(policy.soft, Math.max(1, Math.floor(hard * 0.75))) };
}
