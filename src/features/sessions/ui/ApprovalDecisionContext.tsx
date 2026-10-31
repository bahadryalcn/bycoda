import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import type { ApprovalDecision } from "../../../integrations/harness";
import type { Session } from "../model/session";
import type { ApprovalRequestToken } from "../model/approvalIntents";

export type ApprovalDispatch = (
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
  expected?: ApprovalRequestToken,
) => void | boolean | Promise<void | boolean>;

const Context = createContext<{ session: Session; dispatch: ApprovalDispatch } | null>(null);

/** The actual pane supplies its original Session; a transcript cannot invent it. */
export function ApprovalDecisionProvider({
  session,
  getSession,
  dispatch,
  children,
}: {
  session: Session;
  getSession?: () => Session;
  dispatch: ApprovalDispatch;
  children: ReactNode;
}) {
  const current = useRef(session);
  current.current = session;
  const value = useMemo(() => ({
    get session() { return getSession?.() ?? current.current; },
    dispatch,
  }), [dispatch, getSession]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useApprovalDecisionContext = () => useContext(Context);
