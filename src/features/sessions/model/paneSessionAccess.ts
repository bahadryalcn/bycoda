import type { Session } from "./session";
import { getSessions, selectSessionById } from "./sessionsStore";

/** Read only from event handlers: local sessions follow the store; remote panes follow their committed Host projection. */
export function currentSessionAccessor(
  renderedSession: { readonly current: Session },
  renderedRemote: { readonly current: boolean },
): { readonly current: Session } {
  return {
    get current() {
      const rendered = renderedSession.current;
      return renderedRemote.current
        ? rendered
        : (selectSessionById(getSessions(), rendered.id) ?? rendered);
    },
  };
}
