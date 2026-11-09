import { useT } from "../../../shared/i18n";
import { InlineAction } from "../../../shared/ui/ActionHost";
import { Pin, PinOff } from "../../../shared/ui/icons";
import { toast } from "../../../shared/ui/ToastRegion";
import { toggleProjectGroupPin, type ProjectGroup } from "../model/projectGroups";

/**
 * The pin a pinned rail group (workspace) keeps in its header; clicking it unpins. An unpinned
 * group reserves no header space for it: "Pin group" lives in the group menu.
 */
export function ProjectGroupPinAction({ group }: { group: ProjectGroup }) {
  const t = useT();
  if (!group.pinned) return null;
  return (
    <InlineAction
      reveal="always"
      label={t("Unpin group")}
      tooltipDetails={[group.name]}
      motion="none"
      type="button"
      data-no-drag
      aria-label={t("Unpin group")}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        // The rail reloads from storage on success; a failed save leaves the pin as it was.
        const failed = () =>
          toast.show({ tone: "danger", message: t("Could not save project changes. Try again.") });
        toggleProjectGroupPin(group.id).then((saved) => saved || failed(), failed);
      }}
      className="group/pin shrink-0"
    >
      <Pin className="icon-sm group-hover/pin:hidden" strokeWidth={1.75} />
      <PinOff className="icon-sm hidden group-hover/pin:block" strokeWidth={1.75} />
    </InlineAction>
  );
}
