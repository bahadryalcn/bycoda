import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { observeResize } from "../../../shared/lib/observeResize";
import { Popover } from "../../../shared/ui/Popover";
import { Text } from "../../../shared/ui/Text";
import { SkillIcon } from "../../../shared/ui/icons";
import {
  HOVER_CARD_CLOSE_MS,
  HOVER_CARD_OPEN_MS,
  TOOLTIP_WARM_MS,
  useHoverIntent,
} from "../../../shared/ui/Tooltip";

export type ComposerSkillGroup = { name: string; members: readonly string[] };

const GROUP_TOKEN = "[data-composer-skill-group]";

type TokenRects = { token: HTMLElement; rects: DOMRect[] };

/** Reads every group token's viewport rects once; the rects stay valid until the layout moves. */
function readTokenRects(parent: HTMLElement | null): TokenRects[] {
  return [...(parent?.querySelectorAll<HTMLElement>(GROUP_TOKEN) ?? [])].map((token) => ({
    token,
    rects: [...token.getClientRects()],
  }));
}

function containsPoint(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

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
  // Null means the next hit test reads the rects again. Cleared when the draft, the textarea
  // size or any scroll position changes, because the rects are viewport-relative.
  const tokensRef = useRef<TokenRects[] | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef(0);

  const cancelFrame = useStableCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    pointerRef.current = null;
  });
  // One hit test per frame, however many pointer moves the frame received.
  const hitTest = useStableCallback(() => {
    frameRef.current = 0;
    const el = field?.current;
    const point = pointerRef.current;
    pointerRef.current = null;
    if (!el || !point) return;
    if (tokensRef.current === null) tokensRef.current = readTokenRects(el.parentElement);
    const hit = tokensRef.current.find(({ rects }) =>
      rects.some((rect) => containsPoint(rect, point.x, point.y)),
    )?.token;
    if (!hit) {
      intent.scheduleClose();
      return;
    }
    intent.scheduleOpen(hit);
  });
  const onMove = useStableCallback((event: PointerEvent) => {
    if (!field?.current || event.pointerType === "touch") return;
    pointerRef.current = { x: event.clientX, y: event.clientY };
    if (!frameRef.current) frameRef.current = requestAnimationFrame(hitTest);
  });
  const onLeave = useStableCallback(() => {
    cancelFrame();
    intent.scheduleClose();
  });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Observe the textarea and its reference actions through their common parent.
  useEffect(() => {
    const el = field?.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    // Scroll events do not bubble; the capture listener on window also sees the textarea,
    // its overlay and any scrolling ancestor.
    const dropRects = () => {
      tokensRef.current = null;
    };
    const stopResize = observeResize(el, dropRects);
    window.addEventListener("scroll", dropRects, { capture: true, passive: true });
    parent.addEventListener("pointermove", onMove, true);
    parent.addEventListener("pointerleave", onLeave, true);
    return () => {
      stopResize();
      window.removeEventListener("scroll", dropRects, { capture: true });
      parent.removeEventListener("pointermove", onMove, true);
      parent.removeEventListener("pointerleave", onLeave, true);
      cancelFrame();
    };
  }, [field, onMove, onLeave, cancelFrame]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- the group map is rebuilt on every draft render, so a new map means the token rects may have moved.
  useLayoutEffect(() => {
    tokensRef.current = null;
  }, [groups]);

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
      variant="panel"
      className="max-w-80"
    >
      <Text as="p" size="secondary" weight="medium" truncate>
        {group.name}
      </Text>
      <ul className="mt-1.5 flex max-h-64 flex-col gap-0.5 overflow-y-auto">
        {group.members.map((member) => (
          <li key={member} className="flex items-center gap-1.5">
            <SkillIcon className="icon-xs shrink-0" aria-hidden />
            <Text size="caption" tone="secondary" truncate className="block">
              {member}
            </Text>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
