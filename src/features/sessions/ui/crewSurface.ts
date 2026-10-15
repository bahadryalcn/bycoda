import type { ComponentProps } from "react";
import { lazySurface } from "../../../shared/ui/lazySurface";

export const CrewScene = lazySurface<ComponentProps<typeof import("./CrewScene").CrewScene>>(() =>
  import("./CrewScene").then((module) => ({ default: module.CrewScene })),
);
