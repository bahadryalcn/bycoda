type Publisher = () => Promise<void>;
let publisher: Publisher | undefined;

/** This WebView's mounted publisher owns its authoritative session snapshot. */
export function registerDesktopLivePublisher(next: Publisher): () => void {
  publisher = next;
  return () => {
    if (publisher === next) publisher = undefined;
  };
}

/** Await a fresh acknowledged snapshot; absence/unreachability is not idle proof. */
export async function flushDesktopLive(): Promise<void> {
  if (!publisher)
    throw new Error(
      "The local Host has not published this window. Reconnect before changing workspace state.",
    );
  await publisher();
}
