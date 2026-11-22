/** A Host advertising this accepts `create` in the reserved projectless scope. */
export const PROJECTLESS_SESSIONS_CAPABILITY = "sessions.projectless.v1";

/**
 * Reserved `projectId` for sessions without a project. It addresses `create` and
 * `sessions.list` only: it is never a registered project, and the Host alone picks
 * each session's private scratch folder.
 */
export const PROJECTLESS_PROJECT_ID = "bycoda-projectless-sessions";
