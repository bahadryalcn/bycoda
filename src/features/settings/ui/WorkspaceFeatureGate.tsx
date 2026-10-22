import type { ReactNode } from "react";
import { useWorkspaceFeature, type WorkspaceFeatureId } from "../model/workspaceFeatures";

/** Keep an open tool reachable until the user leaves it. */
export function WorkspaceFeatureGate({
  id,
  active = false,
  children,
}: {
  id: WorkspaceFeatureId;
  active?: boolean;
  children: ReactNode;
}) {
  const visible = useWorkspaceFeature(id);
  return visible || active ? children : null;
}
