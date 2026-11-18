import { type HTMLElement, type HTMLInputElement, Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../src/features/social/model/social";
import type { InstagramHighlightChange } from "../../src/features/social/model/socialBrowser";
import type { BrowserPage } from "./social-browser";
import { readInstagramEarnings } from "./social-browser-instagram-earnings";
import {
  changeInstagramHighlight,
  parseInstagramHighlightChange,
  readInstagramHighlights,
} from "./social-browser-instagram-highlights";
import type { BrowserRecipeContext } from "./social-browser-recipe";

const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

const origin = "https://www.instagram.com";
const owner = "/studio/";
const profileHeader = '<a href="/accounts/edit/">Edit profile</a>';
function fixture() {
  const window = new Window({ url: `${origin}/` });
  windows.push(window);
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 1, height: 1 }],
  });
  const document = window.document;
  const render = (html: string) => {
    document.body.innerHTML = html;
  };
  const click = (selector: string, effect: () => void) => {
    document.querySelector(selector)!.addEventListener("click", effect);
  };
  const page = {
    goto: vi.fn(async (url: string) => {
      window.location.href = url;
      if (window.location.pathname === "/")
        render(`<nav><a href="${owner}" aria-label="Profile"></a></nav>`);
    }),
    evaluate: vi.fn(async <T>(expression: string) => window.eval(expression) as T),
    click: vi.fn(async (selector: string) =>
      document.querySelector<HTMLElement>(selector)!.click(),
    ),
    fill: vi.fn(async (selector: string, value: string) => {
      document.querySelector<HTMLInputElement>(selector)!.value = value;
    }),
  } as unknown as BrowserPage;
  const verifyIdentity = vi.fn(async () => {});
  const context: BrowserRecipeContext = {
    page,
    files: [],
    account: { platformId: "111" } as SocialAccount,
    now: () => 1234,
    waitFor: async <T>(expression: string) => (await page.evaluate<T>(expression)) || undefined,
    verifyIdentity,
  };
  return { window, document, render, click, page, context, verifyIdentity };
}

describe("Instagram earnings via the owned dashboard", () => {
  const dash = "/professional_dashboard/";
  function earnings(options: { foreign?: boolean; challenge?: boolean; ambiguous?: boolean } = {}) {
    const f = fixture();
    vi.mocked(f.page.goto).mockImplementation(async (url) => {
      f.window.location.href = url;
      switch (f.window.location.pathname) {
        case "/":
          f.render(`<nav><a href="${owner}" aria-label="Profile"></a></nav>`);
          break;
        case owner:
          f.render(
            `<main>${profileHeader}<a href="${options.foreign ? "https://example.org" : ""}${dash}">Professional dashboard</a></main>`,
          );
          break;
        case dash:
          f.render('<main><a href="/professional_dashboard/payouts/">Payouts</a></main>');
          break;
        default:
          if (options.challenge) {
            f.render(
              '<main><h1>Security verification</h1><input autocomplete="one-time-code"></main>',
            );
            break;
          }
          f.render(`<main><h1>Earnings</h1>
            <dl><dt>Estimated earnings</dt><dd>$1,234.50</dd>
            <dt>Available for payout</dt><dd>1.204,98 EUR</dd>
            <dt>Bank account</dt><dd>9999 1122 3344</dd>
            ${options.ambiguous ? "<dt>Estimated earnings</dt><dd>$2,345.50</dd>" : ""}
            </dl><button>Change payout method</button></main>`);
      }
    });
    return f;
  }

  it("returns only explicitly labelled currency summaries and never touches payment controls", async () => {
    const f = earnings();
    await expect(readInstagramEarnings(f.context)).resolves.toEqual({
      values: [
        { kind: "estimated", amount: "$1,234.50" },
        { kind: "available", amount: "1.204,98 EUR" },
      ],
      observedAt: 1234,
    });
    expect(f.page.goto).toHaveBeenLastCalledWith(`${origin}${dash}payouts/`);
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.page.fill).not.toHaveBeenCalled();
  });

  it("refuses foreign dashboard links, conflicting monetary summaries, and challenges", async () => {
    const foreign = earnings({ foreign: true });
    await expect(readInstagramEarnings(foreign.context)).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(foreign.page.goto).toHaveBeenCalledTimes(2);
    const ambiguous = earnings({ ambiguous: true });
    await expect(readInstagramEarnings(ambiguous.context)).rejects.toMatchObject({
      code: "unsupported",
    });
    const challenge = earnings({ challenge: true });
    await expect(readInstagramEarnings(challenge.context)).rejects.toMatchObject({
      code: "needs_human",
    });
    expect(challenge.page.click).not.toHaveBeenCalled();
  });
});

function highlightFixture(override: { persist?: boolean; receipt?: boolean } = {}) {
  const f = fixture();
  const content = new Map([["42", { name: "Studio", stories: ["200"] }]]);
  const submit = vi.fn();
  const input = 'input[placeholder="Highlight name"]';
  const activeStory = (id: string) => `input[data-story-id="${id}"]`;
  const addDialog = (inner: string) => {
    f.document.querySelector('[role="dialog"]')?.remove();
    f.document.body.insertAdjacentHTML("beforeend", `<div role="dialog">${inner}</div>`);
  };
  const fieldValue = () => f.document.querySelector<HTMLInputElement>(input)!.value;
  const storyGrid = (saved: string[], button: string, heading = "Stories") =>
    addDialog(`<h2>${heading}</h2><input type="checkbox" data-story-id="200" ${saved.includes("200") ? "checked" : ""}>
      <input type="checkbox" data-story-id="201" ${saved.includes("201") ? "checked" : ""}><button>${button}</button>`);
  const currentStories = () =>
    ["200", "201"].filter(
      (id) => f.document.querySelector<HTMLInputElement>(activeStory(id))!.checked,
    );
  const save = (id: string, name: string, stories: string[]) => {
    submit();
    if (override.persist !== false) content.set(id, { name, stories });
    f.document.querySelector('[role="dialog"]')!.remove();
  };
  const profile = () => {
    f.render(`<main>${profileHeader}<button>New</button>
      ${[...content].map(([id, { name }]) => `<a href="/stories/highlights/${id}/">${name}</a>`).join("")}</main>`);
    f.click("main button", () => {
      addDialog(
        '<h2>New Highlight</h2><input type="text" placeholder="Highlight name"><button>Next</button>',
      );
      f.click('[role="dialog"] button', () => {
        const name = fieldValue();
        storyGrid([], "Next", "Select stories");
        f.click('[role="dialog"] button', () => {
          const stories = currentStories();
          addDialog("<h2>Edit cover</h2><button>Done</button>");
          f.click('[role="dialog"] button', () => save("43", name, stories));
        });
      });
    });
  };
  const view = (id: string) => {
    const current = content.get(id)!;
    f.render('<main><button aria-label="More options"></button></main>');
    f.click("main button", () => {
      addDialog(
        '<button aria-label="Edit">Edit</button><button aria-label="Delete highlight">Delete highlight</button>',
      );
      f.click('button[aria-label="Edit"]', () => {
        addDialog(
          '<h2>Edit Highlight</h2><input type="text" placeholder="Highlight name"><button aria-label="Stories">Stories</button><button aria-label="Done">Done</button>',
        );
        f.document.querySelector<HTMLInputElement>(input)!.value = current.name;
        f.click('button[aria-label="Done"]', () => save(id, fieldValue(), current.stories));
        f.click('button[aria-label="Stories"]', () => {
          const name = fieldValue();
          storyGrid(current.stories, "Done");
          f.click('[role="dialog"] button', () => save(id, name, currentStories()));
        });
      });
      f.click('button[aria-label="Delete highlight"]', () => {
        addDialog(`<h2>Delete highlight?</h2><p>${current.name}</p><button>Delete</button>`);
        f.click('[role="dialog"] button', () => {
          submit();
          if (override.persist !== false) content.delete(id);
          f.document.querySelector('[role="dialog"]')!.remove();
          if (override.receipt !== false)
            f.document.body.insertAdjacentHTML(
              "beforeend",
              '<p role="status">Highlight deleted</p>',
            );
        });
      });
    });
  };
  vi.mocked(f.page.goto).mockImplementation(async (url) => {
    f.window.location.href = url;
    const path = f.window.location.pathname;
    if (path === "/") f.render(`<nav><a href="${owner}">Profile</a></nav>`);
    else if (path === owner) profile();
    else view(path.split("/")[3]);
  });
  return { ...f, content, submit };
}

const create = parseInstagramHighlightChange({
  action: "create",
  name: "Recent",
  storyIds: ["201"],
  confirm: "CREATE_INSTAGRAM_HIGHLIGHT",
});
const edit = parseInstagramHighlightChange({
  action: "edit",
  id: "42",
  name: "Renamed",
  expectedName: "Studio",
  storyIds: ["201"],
  confirm: "EDIT_INSTAGRAM_HIGHLIGHT",
});
const remove = {
  action: "delete",
  id: "42",
  expectedName: "Studio",
  confirm: "DELETE_INSTAGRAM_HIGHLIGHT",
} satisfies InstagramHighlightChange;

describe("Instagram Highlights on an editable owner profile", () => {
  it("lists the owner's visible collection IDs and titles", async () => {
    const f = highlightFixture();
    await expect(readInstagramHighlights(f.context)).resolves.toEqual({
      items: [{ id: "42", name: "Studio" }],
      partial: true,
    });
    expect(f.page.click).not.toHaveBeenCalled();
  });

  it.each([
    [create, "43", "Recent"],
    [edit, "42", "Renamed"],
  ] as const)(
    "persists and reopens a reviewed collection to verify exact membership",
    async (change, id, name) => {
      const f = highlightFixture();
      const gate = vi.fn(async () => {});
      await expect(changeInstagramHighlight(f.context, change, gate)).resolves.toEqual({
        changed: true,
      });
      expect(f.content.get(id)).toEqual({ name, stories: ["201"] });
      expect(f.submit).toHaveBeenCalledOnce();
      expect(gate).toHaveBeenCalledOnce();
    },
  );

  it("requires the exact reviewed name and returns uncertainty after an unconfirmed write without another click", async () => {
    const f = highlightFixture({ receipt: false });
    await expect(
      changeInstagramHighlight(f.context, { ...remove, expectedName: "Another" }, async () => {}),
    ).rejects.toMatchObject({ code: "denied" });
    expect(f.page.click).not.toHaveBeenCalled();
    await expect(changeInstagramHighlight(f.context, remove, async () => {})).rejects.toMatchObject(
      { code: "unknown" },
    );
    expect(f.submit).toHaveBeenCalledOnce();
  });

  it("verifies the deletion receipt and persisted absence", async () => {
    const f = highlightFixture();
    await expect(changeInstagramHighlight(f.context, remove, async () => {})).resolves.toEqual({
      changed: true,
    });
    expect(f.content.has("42")).toBe(false);
    expect(f.submit).toHaveBeenCalledOnce();
  });

  it("rejects a missing Story and a stopped write before any submit", async () => {
    const f = highlightFixture();
    const missing = parseInstagramHighlightChange({ ...create, storyIds: ["999"] });
    await expect(
      changeInstagramHighlight(f.context, missing, async () => {}),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      changeInstagramHighlight(f.context, create, async () => {
        throw new Error("stopped");
      }),
    ).rejects.toThrow("stopped");
    expect(f.submit).not.toHaveBeenCalled();
  });
});
