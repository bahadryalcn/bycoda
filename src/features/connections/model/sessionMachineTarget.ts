import type { Attachment, Session } from "../../sessions";
import { PROJECTLESS_PROJECT_ID } from "../../../shared/model/host-contracts/projectless-sessions";
import {
  parseRemotePath,
  remotePath,
  remoteProjectFor,
  type RemoteProject,
} from "./remoteProjects";

// Registered folders have canonical paths. This key identifies a session scope.
const projectlessRoutePath = `/../${PROJECTLESS_PROJECT_ID}`;

type Scope = Pick<Session, "cwd" | "remoteExecutionEnvironmentId">;

export function projectlessMachineProject(environmentId: string): RemoteProject {
  return {
    key: remotePath(environmentId, projectlessRoutePath),
    environmentId,
    projectId: PROJECTLESS_PROJECT_ID,
    cwd: "~",
  };
}

export function projectlessMachineSession(key: string): Scope | undefined {
  const location = parseRemotePath(key);
  if (location?.hostPath === projectlessRoutePath) {
    return { cwd: "~", remoteExecutionEnvironmentId: location.environmentId };
  }
  return undefined;
}

export function remoteExecutionEnvironment(session: Scope): string | undefined {
  return session.cwd === "~"
    ? session.remoteExecutionEnvironmentId
    : parseRemotePath(session.cwd)?.environmentId;
}

export function remoteSessionProjectKey(session: Scope): string {
  return session.cwd === "~" && session.remoteExecutionEnvironmentId
    ? projectlessMachineProject(session.remoteExecutionEnvironmentId).key
    : session.cwd;
}

export function remoteSessionProject(session: Scope): RemoteProject | undefined {
  return session.cwd === "~" && session.remoteExecutionEnvironmentId
    ? projectlessMachineProject(session.remoteExecutionEnvironmentId)
    : remoteProjectFor(session.cwd);
}

export function remoteSessionProjectAtKey(key: string): RemoteProject | undefined {
  const projectless = projectlessMachineSession(key);
  return projectless ? remoteSessionProject(projectless) : remoteProjectFor(key);
}

export function hasForeignMachineAttachment(
  attachments: readonly Attachment[],
  environmentId: string | undefined,
): boolean {
  return attachments.some((file) => {
    const owner = file.hostEnvironmentId ?? parseRemotePath(file.path ?? "")?.environmentId;
    return !!owner && owner !== environmentId;
  });
}
