/**
 * The files git names when it refuses a checkout ("Your local changes to the following files would
 * be overwritten by checkout:" or the untracked-file variant): the tab-indented lines under that
 * header. Empty when the message names none (the mapped app error, another git wording).
 */
export function checkoutBlockedFiles(message: string): string[] {
  const files: string[] = [];
  let listing = false;
  for (const line of message.split(/\r?\n/)) {
    if (/would be overwritten by (?:checkout|merge)/i.test(line) && line.trimEnd().endsWith(":")) {
      listing = true;
      continue;
    }
    if (!listing) continue;
    if (!/^\s+\S/.test(line)) {
      listing = false;
      continue;
    }
    const file = line.trim();
    if (!files.includes(file)) files.push(file);
  }
  return files;
}
