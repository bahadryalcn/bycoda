/** Helper children that reach grant preparation without a spawn purpose: catalog probes and social image runs. */
const HELPER_CHILD = /^(?:bycoda-[a-z0-9]+-probe|social-image)(?=-|$)/;

/** Helper children have no persisted session and cannot receive session grants.
 * Keep the first diagnostic per helper family and group, without hiding real-session errors. */
export function createProbeGrantWarningFilter() {
  const seen = new Set<string>();
  return (sessionId: string, group: string): boolean => {
    const helper = HELPER_CHILD.exec(sessionId);
    if (!helper) return true;
    const key = `${helper[0]}:${group}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}
