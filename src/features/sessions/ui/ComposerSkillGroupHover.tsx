import { useEffect, useState, type RefObject } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { Popover } from "../../../shared/ui/Popover";
import { Text } from "../../../shared/ui/Text";
import {
  HOVER_CARD_CLOSE_MS,
  HOVER_CARD_OPEN_MS,
  TOOLTIP_WARM_MS,
  useHoverIntent,
} from "../../../shared/ui/Tooltip";

export type ComposerSkillGroup = { name: string; members: readonly string[] };

const GROUP_TOKEN = "[data-composer-skill-group]";

/**
 * Lists a skill group's members while the pointer rests on its draft chip. The chip lives
 * in the pointer-transparent overlay, so the textarea's own pointer moves are hit-tested
 * against the chip's line boxes: clicks still place the caret in the text.
 */
export function ComposerSkillGroupHover({
  field,
  groups,
}: {
  field?: RefObject<HTMLTextAreaElement | null>;
  groups: ReadonlyMap<string, ComposerSkillGroup>;
}) {
  const intent = useHoverIntent({
    group: "hover-card",
    openDelay: HOVER_CARD_OPEN_MS,
    closeDelay: HOVER_CARD_CLOSE_MS,
    warmMs: TOOLTIP_WARM_MS,
  });
  const [prefix, setPrefix] = useState("/");
  const onMove = useStableCallback((event: PointerEvent) => {
    const el = field?.current;
    if (!el || event.pointerType === "touch") return;
    const hit = [...(el.parentElement?.querySelectorAll<HTMLElement>(GROUP_TOKEN) ?? [])].find(
      (token) =>
        [...token.getClientRects()].some(
          (rect) =>
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom,
        ),
    );
    if (!hit) {
      intent.scheduleClose();
      return;
    }
    setPrefix(hit.dataset.composerSkillGroupPrefix ?? "/");
    intent.scheduleOpen(hit);
  });
  const onLeave = useStableCallback(() => intent.scheduleClose());
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- textarea pointer listeners; the pointer-transparent overlay never receives them.
  useEffect(() => {
    const el = field?.current;
    if (!el) return;
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [field, onMove, onLeave]);

  const anchor = intent.anchor;
  const group = anchor?.isConnected
    ? groups.get(anchor.dataset.composerSkillGroup ?? "")
    : undefined;
  if (!anchor || !group) return null;
  return (
    <Popover
      anchor={anchor}
      side="top"
      align="start"
      restoreFocus={false}
      passive
      data-hover-card=""
      onDismiss={() => intent.close()}
      onPointerEnter={() => intent.cancel()}
      onPointerLeave={() => intent.scheduleClose()}
      className="max-w-80 p-3"
    >
      <Text as="p" size="secondary" weight="medium" truncate>
        {group.name}
      </Text>
      <ul className="mt-1.5 flex max-h-64 flex-col gap-0.5 overflow-y-auto">
        {group.members.map((member) => (
          <li key={member}>
            <Text size="caption" tone="secondary" truncate className="block">
              {prefix}
              {member}
            </Text>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
