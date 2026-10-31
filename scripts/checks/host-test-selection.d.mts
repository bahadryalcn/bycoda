export interface HostPortableManifest {
  schemaVersion: number;
  tests: Array<{ file: string; sources: Record<string, string>; reason?: string }>;
}

export const hostTestRoot: string;
export function portableHostTests(root?: string, manifest?: HostPortableManifest): string[];
export function hostTestSelection(
  scope?: string,
  root?: string,
  manifest?: HostPortableManifest,
): { include: string[]; exclude: string[] };
