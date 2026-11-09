import { accountController } from "./accountService";

/** Stable references for hooks that call the account API (they sit in effect deps). */
export const accountApi = () => accountController().api();
export const reportAccountFailure = (error: unknown) => accountController().handleFailure(error);
