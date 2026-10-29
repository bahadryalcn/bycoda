import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ParentAdmission, ParentInputHandle } from "../data/parentInputClosure";
import {
  acknowledgeQuoteRequest,
  ADD_TO_CHAT_EVENT,
  type AddToChatRequest,
  type QuoteRequest,
} from "../model/quoteDraft";

/**
 * "Add to chat" quotes for one pane. Each request holds a Parent input
 * admission until the Composer reports it consumed the text, so a checkpoint
 * cannot close over a quote that is still on its way into the draft.
 */
export function useQuoteRequests(
  rootParentRef: RefObject<ParentInputHandle | null>,
  /** Only the pane that should receive the event listens for it. */
  listening: boolean,
) {
  const [quoteRequest, setQuoteRequest] = useState<QuoteRequest>();
  const quoteRequestId = useRef(0);
  const quoteAdmissions = useRef(new Map<number, ParentAdmission>());

  useLayoutEffect(() => {
    const quotes = quoteAdmissions.current;
    return () => {
      for (const admitted of quotes.values()) admitted.finish();
      quotes.clear();
    };
  }, []);

  const addSelectionToChat = useCallback(
    (text: string, mode?: QuoteRequest["mode"]) => {
      const admitted = rootParentRef.current?.admit();
      if (!admitted) return;
      for (const previous of quoteAdmissions.current.values()) previous.finish();
      quoteAdmissions.current.clear();
      quoteRequestId.current += 1;
      quoteAdmissions.current.set(quoteRequestId.current, admitted);
      setQuoteRequest({ id: quoteRequestId.current, text, mode });
    },
    [rootParentRef],
  );

  const acknowledgeQuote = useCallback(
    (handledId: number) => {
      const admitted = quoteAdmissions.current.get(handledId);
      try {
        if (admitted)
          admitted.apply(() =>
            setQuoteRequest((current) => acknowledgeQuoteRequest(current, handledId)),
          );
        else {
          rootParentRef.current?.();
          setQuoteRequest((current) => acknowledgeQuoteRequest(current, handledId));
        }
      } catch {
        /* A replaced owner keeps the original input; never touch its new view. */
      } finally {
        admitted?.finish();
        quoteAdmissions.current.delete(handledId);
      }
    },
    [rootParentRef],
  );

  useEffect(() => {
    if (!listening) return;
    const onAdd = (event: Event) => {
      const detail = (event as CustomEvent<AddToChatRequest>).detail;
      if (!detail?.text) return;
      addSelectionToChat(detail.text, detail.mode);
    };
    window.addEventListener(ADD_TO_CHAT_EVENT, onAdd);
    return () => window.removeEventListener(ADD_TO_CHAT_EVENT, onAdd);
  }, [addSelectionToChat, listening]);

  /** Parent-input checkpoint view; read lazily, never during render. */
  const snapshot = () => ({ quoteRequest, quoteRequestId: quoteRequestId.current });

  return { quoteRequest, addSelectionToChat, acknowledgeQuote, snapshot };
}
