import { createContext, useContext } from "react";

/** Host used for discovery, installation and key custody. */
export const DecisionTarget = createContext<string | undefined>(undefined);
export const useDecisionTarget = () => useContext(DecisionTarget);
