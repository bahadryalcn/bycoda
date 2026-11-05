/** Public source-control contract; exports stay explicit to preserve load isolation. */
export { gitStatusForPath } from "../hooks/useGitFileStatuses";
export type { GitStatusMap } from "../hooks/useGitFileStatuses";
