import { SocialShell, type SocialShellProps } from "./shell/SocialShell";

export type { SocialHeaderProps, SocialShellProps as SocialViewProps } from "./shell/SocialShell";

/** The Social Media surface mount. The shell owns the workspace, the five sections and the global AI stop. */
export function SocialView(props: SocialShellProps) {
  return <SocialShell {...props} />;
}
