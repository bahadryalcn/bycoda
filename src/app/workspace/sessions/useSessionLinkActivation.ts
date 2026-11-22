import { workspaceFailureDetail } from "../../model/workspaceActionError";
import { useEffect, useLayoutEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listenWindowAsync } from "../../../platform/tauri/listenWindow";
import { parseLocalSessionLink } from "../../../features/sessions/model/localSessionReference";
import type { LocalSessionReferenceNavigation } from "../../../features/sessions/ui/LocalSessionReferenceContext";
import { toast } from "../../../shared/ui/ToastRegion";
import { t } from "../../../shared/i18n";

/** Subscribe before draining so cold and warm OS handoffs cannot miss readiness. */
export function useSessionLinkActivation(navigation: LocalSessionReferenceNavigation) {
  const current = useRef(navigation);
  useLayoutEffect(() => {
    current.current = navigation;
  }, [navigation]);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let active = true;
    let busy = false;
    let again = false;
    let release: (() => void) | undefined;
    const open = async (href: string) => {
      if (!active) return;
      const reference = parseLocalSessionLink(href);
      if (!reference) return;
      try {
        await current.current.open(reference);
      } catch (cause) {
        if (active)
          toast.show({
            tone: "danger",
            title: t("Could not open this local conversation"),
            message:
              cause instanceof Error
                ? workspaceFailureDetail(cause)
                : t("This local conversation is unavailable or inaccessible."),
            action: {
              label: t("Open again"),
              onClick: () => {
                void open(href).catch(console.error);
              },
            },
          });
      }
    };
    const drain = async () => {
      if (!active) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        do {
          again = false;
          const links = await invoke<string[]>("session_links_take_pending");
          for (const href of links ?? []) await open(href);
        } while (active && again);
      } catch (cause) {
        if (active)
          toast.show({
            tone: "danger",
            title: t("Could not open the pending conversation links"),
            message: workspaceFailureDetail(cause),
          });
      } finally {
        busy = false;
      }
    };
    void listenWindowAsync("bycoda:session-link", () => {
      void drain().catch(console.error);
    })
      .then((unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        release = unlisten;
        return drain();
      })
      .catch((cause) => {
        if (active)
          toast.show({
            tone: "danger",
            title: t("Could not open the pending conversation links"),
            message: workspaceFailureDetail(cause),
          });
      });
    return () => {
      active = false;
      release?.();
    };
  }, []);
}
