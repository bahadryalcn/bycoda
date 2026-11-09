export interface BriefingSection {
  label: string;
  items: string[];
}

export interface BriefingParts {
  /** First line: the greeting and count sentences. In the fallback it is the whole text. */
  lead: string;
  /** Labelled bullet groups, without the notes section (Today shows the notes). */
  sections: BriefingSection[];
  /** Footnote lines the Host appends after the sections. */
  notes: string[];
}

/** The Host's localized label of the notes section (`assistantDetailedBriefingText`, index 5). */
const NOTES_LABELS = new Set([
  "Today and yesterday's notes",
  "Bugünün ve dünün notları",
  "Notizen von heute und gestern",
  "Notes d’aujourd’hui et d’hier",
  "Notas de hoy y ayer",
  "Notas de hoje e ontem",
  "今天和昨天的笔记",
  "今日と昨日のメモ",
]);
/** The Host writes at most two footnote lines. */
const MAX_FOOTNOTES = 2;
const BULLET = /^•\s*(.*)$/;

/**
 * Splits the Host briefing (greeting line, then `Label:` lines each followed by `• item` lines,
 * then footnotes) into parts. Text that does not follow that shape comes back as one lead paragraph.
 */
export function briefingSections(text: string): BriefingParts {
  const whole: BriefingParts = { lead: text.trim(), sections: [], notes: [] };
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2 || BULLET.test(lines[0]!) || lines[0]!.endsWith(":")) return whole;
  const sections: BriefingSection[] = [];
  const notes: string[] = [];
  let current: BriefingSection | null = null;
  for (const line of lines.slice(1)) {
    const bullet = BULLET.exec(line);
    if (bullet) {
      if (!current || notes.length) return whole;
      if (bullet[1]) current.items.push(bullet[1]);
    } else if (line.endsWith(":") && !notes.length) {
      current = { label: line.slice(0, -1).trim(), items: [] };
      sections.push(current);
    } else {
      current = null;
      notes.push(line);
    }
  }
  if (notes.length > MAX_FOOTNOTES || sections.some((section) => !section.items.length))
    return whole;
  return {
    lead: lines[0]!,
    sections: sections.filter((section) => !NOTES_LABELS.has(section.label)),
    notes,
  };
}
