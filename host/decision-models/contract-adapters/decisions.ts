import { createSystemOneAdapter } from "./systemone";

// shortcut: the /v1/decisions request and response layout is a contract assumption (D13). It reuses the
// System One body and parser. Replace it with the verified schema before enabling a source of this adapter.
export const decisionsAdapter = createSystemOneAdapter("decisions");
