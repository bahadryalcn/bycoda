/**
 * The Host narrows a crew member's provider-native tools by adding this setting to the
 * provider input of its session (`host/crews/crew-native-tools.ts`). Adapters that can
 * honor it read it here; it only ever removes tools and never widens the run's mode.
 */
export const NATIVE_TOOLS_KEY = "nativeTools";
export const NATIVE_TOOLS_READ_ONLY = "read-only";

export const nativeReadOnly = (settings: Readonly<Record<string, string>> | undefined): boolean =>
  settings?.[NATIVE_TOOLS_KEY] === NATIVE_TOOLS_READ_ONLY;
