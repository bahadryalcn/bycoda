import { fileURLToPath } from "node:url";
import { prepareProviderGuardian } from "./provider-guardian-deployment";
import type { GuardianLaunch, NativeGuardianChild } from "./provider-guardian";

/** The packaged guardian owns a Windows job. Other platforms retain the identity-checked fallback. */
export async function prepareDevServerGuardian(): Promise<
  | {
      spawn(
        launch: GuardianLaunch,
        beforeStart: () => Promise<void>,
        commitStart: () => void,
      ): NativeGuardianChild;
      dispose(): Promise<void>;
    }
  | undefined
> {
  if (process.platform !== "win32") return undefined;
  const prepared = await prepareProviderGuardian(fileURLToPath(new URL("./", import.meta.url)));
  if (!prepared) return undefined;
  return {
    spawn: (launch, beforeStart, commitStart) => prepared.spawn(launch, beforeStart, commitStart),
    dispose: () => prepared.dispose(),
  };
}
