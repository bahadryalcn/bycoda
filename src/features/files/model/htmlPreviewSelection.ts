import type { TranscriptSelection } from "../../sessions/model/transcriptSelection";

/** Runs inside the opaque sandbox. Messages only offer text; a parent UI click adds it. */
export function withHtmlSelectionBridge(source: string, channel: string): string {
  const script = `<script>(()=>{
    const channel=${JSON.stringify(channel)};
    let dragging=false;
    const clear=()=>parent.postMessage({channel,selection:null},'*');
    const report=()=>{
      const s=getSelection();
      if(!s || s.isCollapsed || !s.rangeCount || !s.toString().trim()) return clear();
      const r=s.getRangeAt(0).getBoundingClientRect();
      parent.postMessage({channel,selection:{text:s.toString(),x:r.x,y:r.y,width:r.width,height:r.height}},'*');
    };
    document.addEventListener('pointerdown',()=>{dragging=true;clear()});
    document.addEventListener('pointerup',()=>{dragging=false;report()});
    document.addEventListener('pointercancel',()=>{dragging=false;clear()});
    document.addEventListener('selectionchange',()=>{if(!dragging) report()});
    document.addEventListener('scroll',clear,true);
    window.addEventListener('resize',clear);
  })();</script>`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(source);
  const offset = doctype?.[0].length ?? 0;
  return source.slice(0, offset) + script + source.slice(offset);
}

export function readHtmlPreviewSelection(
  data: unknown,
  channel: string,
  frame: DOMRect,
): TranscriptSelection | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (message.channel !== channel || !message.selection || typeof message.selection !== "object")
    return null;
  const value = message.selection as Record<string, unknown>;
  if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 100_000)
    return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const rect = { x: x as number, y: y as number, width: width as number, height: height as number };
  if (
    rect.width < 0 ||
    rect.height <= 0 ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x >= frame.width ||
    rect.y >= frame.height
  )
    return null;
  return {
    text: value.text.trim(),
    rect: new DOMRect(
      frame.x + rect.x,
      frame.y + rect.y,
      Math.min(rect.width, frame.width - rect.x),
      Math.min(rect.height, frame.height - rect.y),
    ),
  };
}
