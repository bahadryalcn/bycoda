import {
  loadPhysicalStoreAdmission,
  type PhysicalStoreAdmission,
} from "../../packages/physical-store-admission-node/index.mjs";

/** Only accepts an artifact already verified by the Host bundle selector. */
export function bundledMechanicalLoaders(select: () => { path: string } | undefined) {
  return {
    loadBundledNoReplace(): (from: string, to: string) => void {
      const artifact = select();
      const rename = artifact && loadPhysicalStoreAdmission(artifact.path).renameNoReplace;
      if (!rename) throw new Error("Cross-volume move is unsupported by this Host installation.");
      return rename;
    },
    loadBundledWindowsProcessBirths(): PhysicalStoreAdmission["windowsProcessBirths"] {
      const artifact = select();
      return artifact && loadPhysicalStoreAdmission(artifact.path).windowsProcessBirths;
    },
    loadBundledWindowsListeners(): PhysicalStoreAdmission["windowsListeners"] {
      const artifact = select();
      return artifact && loadPhysicalStoreAdmission(artifact.path).windowsListeners;
    },
    loadBundledGuardedMove(): NonNullable<PhysicalStoreAdmission["guardedMove"]> {
      const artifact = select();
      const move = artifact && loadPhysicalStoreAdmission(artifact.path).guardedMove;
      if (!move || process.platform === "win32")
        throw new Error("Guarded cross-volume move is unsupported by this Host installation.");
      return move;
    },
  };
}
