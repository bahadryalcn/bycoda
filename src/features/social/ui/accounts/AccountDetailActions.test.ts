// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialAccount, SocialSnapshot } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { AccountDetail } from "./AccountDetail";

type Seen = Record<string, Record<string, unknown>>;
const seen = vi.hoisted((): Seen => ({}));
const confirmRequests = vi.hoisted(
  () => [] as { title: string; danger?: boolean; message: unknown }[],
);
const confirmAnswer = vi.hoisted(() => ({ accept: true }));

vi.mock("../../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({
    confirm: async (request: {
      title: string;
      danger?: boolean;
      message: unknown;
      onConfirm?: () => Promise<void>;
    }) => {
      confirmRequests.push(request);
      if (!confirmAnswer.accept) return false;
      await request.onConfirm?.();
      return true;
    },
    dialog: null,
  }),
}));
vi.mock("../common/ScreenHeader", () => ({
  ScreenHeader: (props: {
    title: string;
    description?: string;
    secondary?: { id: string; label: string; disabled?: boolean; onSelect: () => void }[];
  }) =>
    createElement(
      "header",
      null,
      createElement("h2", null, props.title),
      createElement("p", { "data-testid": "description" }, props.description),
      ...(props.secondary ?? []).map((item) =>
        createElement(
          "button",
          { key: item.id, "data-menu": item.id, disabled: item.disabled, onClick: item.onSelect },
          item.label,
        ),
      ),
    ),
}));
vi.mock("./AccountConnection", () => ({
  AccountConnection: (props: Record<string, unknown>) => {
    seen.connection = props;
    return null;
  },
}));
vi.mock("./AccountPermissions", () => ({
  AccountPermissions: (props: Record<string, unknown>) => {
    seen.permissions = props;
    return null;
  },
}));
vi.mock("./AutonomySettings", () => ({
  AutonomySettings: (props: Record<string, unknown>) => {
    seen.autonomy = props;
    return null;
  },
}));
vi.mock("./BrowserSettings", () => ({
  BrowserSettings: (props: Record<string, unknown>) => {
    seen.browser = props;
    return null;
  },
}));
vi.mock("./ReplyRules", () => ({
  ReplyRules: (props: Record<string, unknown>) => {
    seen.rules = props;
    return null;
  },
}));

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  for (const key of Object.keys(seen)) delete seen[key];
  confirmRequests.length = 0;
  confirmAnswer.accept = true;
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

const account = (patch: Partial<SocialAccount> = {}): SocialAccount =>
  ({
    id: "a1",
    platform: "instagram",
    name: "Studio",
    accountType: "professional",
    connection: "oauth",
    connected: true,
    paused: false,
    grants: {},
    executorId: "e1",
    ...patch,
  }) as unknown as SocialAccount;

const snapshot = {
  executorId: "e1",
  hostOnline: true,
  capabilities: {},
} as unknown as SocialSnapshot;

function render(
  request: ReturnType<typeof vi.fn>,
  props: {
    account?: SocialAccount;
    hostOnline?: boolean;
    snapshot?: SocialSnapshot;
    needsHuman?: boolean;
  } = {},
) {
  const onChanged = vi.fn();
  act(() =>
    root.render(
      createElement(AccountDetail, {
        client: { request } as unknown as SocialClient,
        account: props.account ?? account(),
        snapshot: props.snapshot ?? snapshot,
        projects: [],
        needsHuman: props.needsHuman ?? false,
        hostOnline: props.hostOnline ?? true,
        onChanged,
      }),
    ),
  );
  return onChanged;
}

const menu = (id: string) => element.querySelector<HTMLButtonElement>(`button[data-menu="${id}"]`);

it("pauses the account from the menu and refreshes", async () => {
  const request = vi.fn(async () => ({}));
  const onChanged = render(request);
  expect(menu("pause")?.textContent).toBe("Pause account");
  await act(async () => menu("pause")?.click());
  expect(request).toHaveBeenCalledExactlyOnceWith("accounts.pause", {
    accountId: "a1",
    paused: true,
  });
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("offers Resume for a paused account and sends the opposite value", async () => {
  const request = vi.fn(async () => ({}));
  render(request, { account: account({ paused: true }) });
  expect(menu("pause")?.textContent).toBe("Resume account");
  expect(element.textContent).toContain("Paused");
  await act(async () => menu("pause")?.click());
  expect(request).toHaveBeenCalledExactlyOnceWith("accounts.pause", {
    accountId: "a1",
    paused: false,
  });
});

it("shows the failure and does not refresh when the Host refuses to pause", async () => {
  const request = vi.fn(async () => {
    throw new Error("The Host is busy.");
  });
  const onChanged = render(request);
  await act(async () => menu("pause")?.click());
  expect(element.textContent).toContain("The Host is busy.");
  expect(onChanged).not.toHaveBeenCalled();
});

it("asks with a danger confirmation before removing a connection and removes only after it", async () => {
  const request = vi.fn(async () => ({}));
  const onChanged = render(request);
  await act(async () => menu("remove")?.click());
  expect(confirmRequests).toHaveLength(1);
  expect(confirmRequests[0]?.danger).toBe(true);
  expect(confirmRequests[0]?.title).toBe("Remove the connection of Studio?");
  expect(request).toHaveBeenCalledExactlyOnceWith("accounts.disconnect", { accountId: "a1" });
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("keeps the connection when the owner declines the removal", async () => {
  confirmAnswer.accept = false;
  const request = vi.fn(async () => ({}));
  const onChanged = render(request);
  await act(async () => menu("remove")?.click());
  expect(confirmRequests).toHaveLength(1);
  expect(request).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
});

it("has nothing to remove for an account that is not connected", () => {
  render(vi.fn(), { account: account({ connected: false }) });
  expect(menu("remove")?.disabled).toBe(true);
  expect(element.textContent).toContain("Connection needed");
});

it("disables both menu actions while the Host is offline", () => {
  render(vi.fn(), { hostOnline: false });
  expect(menu("pause")?.disabled).toBe(true);
  expect(menu("remove")?.disabled).toBe(true);
  expect(seen.connection?.disabled).toBe(true);
  expect(seen.permissions?.disabled).toBe(true);
  expect(seen.autonomy?.disabled).toBe(true);
  expect(seen.rules?.disabled).toBe(true);
});

it("tells the connection card whether the account lives on this computer", () => {
  render(vi.fn(), { account: account({ executorId: "other" }) });
  expect(seen.connection?.onThisComputer).toBe(false);
  expect(element.querySelector('[data-testid="description"]')?.textContent).toContain(
    "On another computer",
  );
  render(vi.fn(), { account: account({ executorId: "e1" }) });
  expect(seen.connection?.onThisComputer).toBe(true);
  expect(element.querySelector('[data-testid="description"]')?.textContent).toContain(
    "On this computer",
  );
});

it("shows the browser options only for a browser account and passes the waiting-for-you flag", () => {
  render(vi.fn(), { account: account({ connection: "oauth" }) });
  expect(seen.browser).toBeUndefined();
  render(vi.fn(), { account: account({ connection: "browser" }), needsHuman: true });
  expect(seen.browser?.accountId).toBe("a1");
  expect(seen.browser?.needsHuman).toBe(true);
  expect(element.textContent).toContain("Waiting for you");
});

it("keeps connection, who may use the account and how far AI may act as separate cards", () => {
  render(vi.fn());
  expect(seen.connection).toBeDefined();
  expect(seen.permissions).toBeDefined();
  expect(seen.autonomy).toBeDefined();
  // Each card owns its own writes; none receives another card's handler.
  expect(Object.keys(seen.autonomy ?? {}).sort()).toEqual([
    "account",
    "client",
    "disabled",
    "onChanged",
  ]);
  expect(Object.keys(seen.permissions ?? {}).sort()).toEqual([
    "account",
    "client",
    "disabled",
    "onChanged",
    "projects",
  ]);
});
