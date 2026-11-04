export const SKILL_INSTALL_PROVIDERS = [
  "all",
  "claude",
  "codex",
  "cursor",
  "opencode",
  "pi",
  "omp",
  "fx",
  "grok",
  "hermes",
  "antigravity",
] as const;
export type SkillInstallProvider = (typeof SKILL_INSTALL_PROVIDERS)[number];
export type SkillInstallRequest = {
  requestId: string;
  skillId: string;
  scope: "project" | "user";
  provider: SkillInstallProvider;
  cwd: string;
};
export type SkillInstallResult = {
  requestId: string;
  skillId: string;
  status: "pending" | "installed" | "failed" | "unknown";
  path?: string;
  commit?: string;
  error?: string;
};
