import { createContext, useContext, useMemo, type ReactNode } from "react";
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
  dispatch,
  children,
}: {
  session: Session;
  dispatch: ApprovalDispatch;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ session, dispatch }), [session, dispatch]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useApprovalDecisionContext = () => useContext(Context);
