import * as inboxSeen from "../../../src/features/inbox/model/inboxSeen";
import * as inboxSeenStorage from "../../../src/features/inbox/model/inboxSeenStorage";
import React from "react";
import { createRoot } from "react-dom/client";

function mountProbes(count: number) {
  const container = document.createElement("div");
  document.body.append(container);
  function Probe({ index }: { index: number }) {
    const unseen = inboxSeen.useInboxItemUnseen(
      { key: `probe:${index}`, updatedAt: new Date(200).toISOString() },
      true,
    );
    return React.createElement("span", { "data-unseen": unseen ? "yes" : "no" });
  }
  const root = createRoot(container);
  root.render(
    React.createElement(
      React.Fragment,
      null,
      ...Array.from({ length: count }, (_, index) =>
        React.createElement(Probe, { index, key: index }),
      ),
    ),
  );
  return () => {
    root.unmount();
    container.remove();
  };
}
Object.assign(window, { inboxSeen, inboxSeenStorage, mountProbes });
