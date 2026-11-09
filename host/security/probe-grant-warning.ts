/** Catalog probes have no persisted session and cannot receive session grants.
 * Keep the first diagnostic per provider/family, without hiding real-session errors. */
export function createProbeGrantWarningFilter() {
  const seen = new Set<string>();
  return (sessionId: string, group: string): boolean => {
    const probe = /^bycoda-([a-z0-9]+)-probe(?:-|$)/.exec(sessionId);
    if (!probe) return true;
    const key = `${probe[1]}:${group}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}
