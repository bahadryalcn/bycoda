import { pathKey } from "../../../shared/lib/paths";
import { t } from "../../../shared/i18n";
import type { Session } from "./session";

/** A feature-owned conversation scope. This identifies a conversation, never a tool grant. */
export type PanelSessionScope = { key: string; cwd: string; title: string };
export type PanelSessionPortal = { sessionId: string; host: HTMLElement };
type PanelSessionDependencies = {
  read(key: string): string | null;
  write(key: string, id: string): void;
  find(id: string): Session | undefined;
  load(id: string): Promise<Session | null>;
  create(scope: PanelSessionScope): Promise<Session>;
  attach(session: Session): void;
};
const opening = new Map<string, Promise<string>>();

/** Reuses persisted and running conversations and fences simultaneous opens of the same scope. */
export function openPanelSession(
  scope: PanelSessionScope,
  dependencies: PanelSessionDependencies,
): Promise<string> {
  const pending = opening.get(scope.key);
  if (pending) return pending;
  const operation = (async () => {
    if (!scope.key || !scope.cwd || scope.cwd === "~")
      throw new Error(t("Choose a project to open this conversation."));
    const id = dependencies.read(scope.key);
    let session = id ? (dependencies.find(id) ?? (await dependencies.load(id))) : undefined;
    if (
      session &&
      (pathKey(session.cwd) !== pathKey(scope.cwd) || session.inboxAsk || session.worktreeRemoved)
    )
      session = undefined;
    session ??= await dependencies.create(scope);
    dependencies.attach(session);
    dependencies.write(scope.key, session.id);
    return session.id;
  })().finally(() => opening.delete(scope.key));
  opening.set(scope.key, operation);
  return operation;
}
