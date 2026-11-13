import type { RecentProject } from "../../../projects/public/recents";
import { ModelsPage } from "../models/ModelsPage";

/** Composes the existing Host routing and delegation settings. */
export function WorkPage({ cwd, recents }: { cwd?: string; recents?: RecentProject[] }) {
  return <ModelsPage cwd={cwd} recents={recents} work />;
}
