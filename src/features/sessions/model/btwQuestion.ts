export function compactQuestion(text: string | undefined): string {
  const compact = text?.replace(/\s+/g, " ").trim() || "New question";
  return compact.length > 48 ? `${compact.slice(0, 45)}…` : compact;
}
