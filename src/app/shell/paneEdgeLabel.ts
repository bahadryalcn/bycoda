import type { PaneEdge } from "../../features/workspace/model/layout";

type Translate = (text: string) => string;

/** The edge of a pane as drop-preview wording; one literal per edge so the locale check sees each. */
export function paneEdgeLabel(edge: PaneEdge, t: Translate): string {
  if (edge === "left") return t("left");
  if (edge === "right") return t("right");
  if (edge === "top") return t("top");
  if (edge === "bottom") return t("bottom");
  return t("center");
}
