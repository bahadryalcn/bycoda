/** GitHub CLI state for this computer, as reported by the desktop (git_github_status). */
export type GithubStatus = {
  connected: boolean;
  installed: boolean;
  authenticated: boolean;
  /** The pinned GitHub CLI is downloading or being verified. */
  installing: boolean;
  /** Set only after an automatic install failed; a check again retries it. */
  installError?: string;
};
