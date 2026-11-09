/** Shared helpers for the Audience UI tests: a mounted root, flushing, controlled inputs and a client mock. */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import type { SocialList, SocialPerson } from "../../model/audience";
import type { SocialClient } from "../../model/socialClient";
import type { SocialAccount } from "../../model/social";

export type MountedHost = {
  element: HTMLDivElement;
  render: (node: ReactElement) => void;
  unmount: () => void;
};

export function mountHost(): MountedHost {
  const element = document.createElement("div");
  document.body.append(element);
  const root: Root = createRoot(element);
  return {
    element,
    render: (node) => act(() => root.render(node)),
    unmount: () => {
      act(() => root.unmount());
      element.remove();
    },
  };
}

/** Lets resolved promises and one timer tick run; call twice after a mount that chains requests. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

type Settable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Sets a controlled field the way a user does: native value setter, then the matching event. */
export function setFieldValue(field: Settable, value: string): void {
  const proto =
    field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

export function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

export function buttonsByText(text: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button")).filter(
    (button) => button.textContent?.trim() === text,
  );
}

export function clickButton(text: string): void {
  const button = buttonByText(text);
  if (!button) throw new Error(`No button "${text}"`);
  act(() => button.click());
}

export function bodyText(): string {
  return document.body.textContent ?? "";
}

export const ACCOUNT = {
  id: "acc1",
  platform: "x",
  platformId: "100",
  name: "Brand",
  accountType: "organization",
} as unknown as SocialAccount;

export function person(overrides: Partial<SocialPerson> = {}): SocialPerson {
  return {
    id: "p1",
    name: "Ada",
    handles: [
      {
        accountId: "acc1",
        platform: "x",
        platformId: "555",
        contactId: "c1",
        username: "ada",
      },
    ],
    emails: [],
    tags: [],
    notes: "",
    stage: "new",
    source: "comment",
    projectIds: [],
    consent: { basis: "inbound" },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** A client whose every method used by the Audience screen is a resolving mock. */
export function clientMock(overrides: Record<string, unknown> = {}) {
  const mock = {
    snapshot: vi.fn(async () => ({ accounts: [ACCOUNT] })),
    lists: {
      list: vi.fn(async () => ({ items: [] })),
      save: vi.fn(async (input: Record<string, unknown>) => ({ id: "l-new", ...input })),
      delete: vi.fn(async () => ({ deleted: true })),
      addMembers: vi.fn(async () => ({ changed: 1 })),
      removeMembers: vi.fn(async () => ({ changed: 1 })),
    },
    people: {
      list: vi.fn(async () => ({ items: [] as SocialPerson[] })),
      get: vi.fn(async (personId: string) => ({
        person: person({ id: personId }),
        interactions: [],
        enrollments: [],
        suppressed: false,
      })),
      update: vi.fn(async (input: { personId: string; patch: Partial<SocialPerson> }) =>
        person({ id: input.personId, ...input.patch }),
      ),
      merge: vi.fn(async () => person()),
      matchSuggestions: vi.fn(async () => ({ suggestions: [] })),
      delete: vi.fn(async () => ({ deleted: true })),
      export: vi.fn(async () => ({ json: "{}" })),
    },
    audience: {
      collect: vi.fn(async () => ({ collected: 2, skipped: 1 })),
      import: vi.fn(async () => ({ imported: 0, rejected: [] })),
    },
    captureRules: {
      list: vi.fn(async () => ({ items: [] })),
      save: vi.fn(async (input: Record<string, unknown>) => ({
        id: "r-new",
        enabled: false,
        ...input,
      })),
      setEnabled: vi.fn(async (input: { id: string; enabled: boolean }) => ({
        id: input.id,
        enabled: input.enabled,
      })),
      delete: vi.fn(async () => ({ deleted: true })),
    },
    sequences: {
      list: vi.fn(async () => ({ items: [] })),
      save: vi.fn(async (input: Record<string, unknown>) => ({
        id: "s-new",
        status: "draft",
        ...input,
      })),
      start: vi.fn(async (sequenceId: string) => ({ id: sequenceId, status: "active" })),
      pause: vi.fn(async (sequenceId: string) => ({ id: sequenceId, status: "paused" })),
      stats: vi.fn(async () => ({ sent: 0, replied: 0, positive: 0, optedOut: 0, failed: 0 })),
    },
    email: {
      accounts: {
        list: vi.fn(async () => ({ items: [] })),
      },
    },
    suppressions: {
      add: vi.fn(async (input: Record<string, unknown>) => ({ id: "x", ...input })),
    },
    ai: {
      command: vi.fn(async () => ({ planId: "plan", steps: [] })),
    },
    ...overrides,
  };
  return mock;
}

/** Tests pass the mock where a SocialClient is expected: `asClient(mock)`. */
export function asClient(mock: ClientMock): SocialClient {
  return mock as unknown as SocialClient;
}

export type ClientMock = ReturnType<typeof clientMock>;

/** The control a visible label points at. Exact text wins; a label that only starts with it is the fallback. */
export function fieldByLabel(
  text: string,
  scope: ParentNode = document,
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const labels = Array.from(scope.querySelectorAll("label"));
  const label =
    labels.find((item) => item.textContent?.trim() === text) ??
    labels.find((item) => item.textContent?.trim().startsWith(text));
  if (!label) throw new Error(`No label "${text}"`);
  const control = label.htmlFor
    ? document.getElementById(label.htmlFor)
    : label.querySelector("input,select,textarea");
  if (!control) throw new Error(`Label "${text}" points at no control`);
  return control as HTMLInputElement;
}

/** Items of an open DropdownMenu are buttons with a menuitem role and the label as aria-label. */
export function menuItem(label: string): HTMLButtonElement | undefined {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      (item) => item.getAttribute("aria-label") === label,
    ) ?? undefined
  );
}

export function clickMenuItem(label: string): void {
  const item = menuItem(label);
  if (!item) throw new Error(`No menu item "${label}"`);
  act(() => item.click());
}

export function tabByText(text: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(
    (tab) => tab.textContent?.trim() === text,
  );
}

/** A promise the test settles by hand, to hold a Host answer back while the screen moves on. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export const STATIC_LIST = {
  id: "l1",
  name: "Buyers",
  kind: "static",
  projectIds: [],
  createdAt: 1,
} as SocialList;

export const SEGMENT_LIST = {
  id: "s1",
  name: "Turkish",
  kind: "dynamic",
  filter: { language: "tr" },
  projectIds: [],
  createdAt: 1,
} as SocialList;
