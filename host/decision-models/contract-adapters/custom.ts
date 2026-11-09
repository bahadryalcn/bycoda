import { createSystemOneAdapter } from "./systemone";

// shortcut: custom endpoints use the System One layout with a bearer key. The auth header name, path override
// and field mapping described in the product plan need new DecisionSource fields (owner request in the done file).
export const customAdapter = createSystemOneAdapter("custom");
