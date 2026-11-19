import { listWindowsDrives, statFiles } from "../../../platform/tauri/fs";
import { withTimeout } from "../../../shared/lib/withTimeout";

/** Longest a single drive may take to answer; a stale share or empty card reader is dropped past it. */
export const DRIVE_ROOT_TIMEOUT_MS = 2000;

/**
 * Lists the Windows drive roots that are directories. Letters come from the OS bitmask, and each
 * root is stat-checked under its own deadline, so one hung drive never delays the others.
 * `onRoots` receives the accumulated roots in drive-letter order each time one resolves; a drive
 * that times out or fails is left out. Rejects only when the OS enumeration itself fails.
 */
export async function probeWindowsDriveRoots(
  isCurrent: () => boolean,
  onRoots: (roots: string[]) => void,
): Promise<void> {
  const drives = await listWindowsDrives();
  const found: string[] = [];
  await Promise.all(
    drives.map(async (root) => {
      try {
        const [item] = await withTimeout(statFiles([root]), DRIVE_ROOT_TIMEOUT_MS, `Stat ${root}`);
        if (!item?.isDir || !isCurrent()) return;
        found.push(root);
        found.sort();
        onRoots([...found]);
      } catch {
        // Timed out or unreachable: this drive is not offered in the switcher.
      }
    }),
  );
}
