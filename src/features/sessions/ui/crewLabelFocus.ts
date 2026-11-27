import { observeResize } from "../../../shared/lib/observeResize";
import { inspectTooltipAnchor } from "../../../shared/ui/tooltipVisibility";

export function reachWhenClipped(label: HTMLElement | null) {
  if (!label) return;
  const sync = () => {
    if (inspectTooltipAnchor(label).clipped) {
      label.tabIndex = 0;
      label.dataset.clipped = "true";
      return;
    }
    label.removeAttribute("tabindex");
    delete label.dataset.clipped;
  };
  sync();
  const stopResize = observeResize(label, sync);
  const mutations = new MutationObserver(sync);
  mutations.observe(label, { subtree: true, childList: true, characterData: true });
  return () => {
    stopResize();
    mutations.disconnect();
    label.removeAttribute("tabindex");
    delete label.dataset.clipped;
  };
}
