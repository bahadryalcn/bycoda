import { createContext, useContext, type ReactNode } from "react";
import { HostModelSource } from "../../../connections/public/HostModelSource";
import type { RemoteMachine } from "../../../connections/public/protocol";

/** Social executes on its selected Host, independently of the main workspace. */
export const SocialModelTargetContext = createContext<
  { machine?: RemoteMachine; cwd: string } | undefined
>(undefined);

/** Bind each picker with its own saved settings, including inherited and unlisted values. */
export function SocialModelSource({
  model,
  values,
  children,
}: {
  model: string;
  values: Record<string, string>;
  children: ReactNode;
}) {
  const target = useContext(SocialModelTargetContext);
  // Standalone controls keep their intentional local or fixture ModelSource boundary.
  if (!target) return children;
  return (
    <HostModelSource machine={target.machine} cwd={target.cwd} model={model} values={values}>
      {children}
    </HostModelSource>
  );
}
