import type {
  InstagramHighlight,
  InstagramHighlightChange,
  InstagramHighlights,
} from "../../src/features/social/model/socialBrowser";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import {
  checkInstagramOwner,
  INSTAGRAM_ORIGIN,
  instagramControls,
  openInstagramOwnerProfile,
  ownerProfileProof,
  requireInstagramOwnerProfile,
} from "./social-browser-instagram-owner";
import { numeric } from "./social-browser-meta-shared";
import type { BrowserRecipeContext } from "./social-browser-recipe";

const MAX_HIGHLIGHTS = 50;
const MAX_STORIES = 100;
const marker = "data-bycoda-instagram-highlight";
const target = `[${marker}="true"]`;
const highlightsPath = String.raw`^/stories/highlights/(\d{1,30})/?$`;
const createLabels = ["New", "New highlight", "Story highlight", "Yeni", "Yeni öne çıkan"];
const editLabels = ["Edit", "Edit highlight", "Düzenle", "Öne çıkanı düzenle"];
const deleteLabels = ["Delete highlight", "Öne çıkanı sil", "Öne Çıkanı Sil"];
const dialogHeadings = [
  "New highlight",
  "New Highlight",
  "Edit highlight",
  "Edit Highlight",
  "Yeni öne çıkan",
  "Öne çıkanı düzenle",
];
const buttons = 'button,[role="button"]';

function nameOf(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    [...value.trim()].length > 100 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new SocialPlatformError("rejected");
  return value.replace(/\s+/g, " ").trim();
}

function storiesOf(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > MAX_STORIES ||
    !value.every(numeric) ||
    new Set(value).size !== value.length
  )
    throw new SocialPlatformError("rejected");
  return value;
}

export function parseInstagramHighlightChange(
  input: Record<string, unknown>,
): InstagramHighlightChange {
  if (input.action === "create" && input.confirm === "CREATE_INSTAGRAM_HIGHLIGHT")
    return {
      action: "create",
      name: nameOf(input.name),
      storyIds: storiesOf(input.storyIds),
      confirm: input.confirm,
    };
  if (input.action === "edit" && input.confirm === "EDIT_INSTAGRAM_HIGHLIGHT" && numeric(input.id))
    return {
      action: "edit",
      id: input.id,
      expectedName: nameOf(input.expectedName),
      name: nameOf(input.name),
      ...(input.storyIds === undefined ? {} : { storyIds: storiesOf(input.storyIds) }),
      confirm: input.confirm,
    };
  if (
    input.action === "delete" &&
    input.confirm === "DELETE_INSTAGRAM_HIGHLIGHT" &&
    numeric(input.id)
  )
    return {
      action: "delete",
      id: input.id,
      expectedName: nameOf(input.expectedName),
      confirm: input.confirm,
    };
  throw new SocialPlatformError("rejected");
}

function probe(path: string, body: string): string {
  return `(() => {
    ${instagramControls}
    if (location.origin !== ${JSON.stringify(INSTAGRAM_ORIGIN)} ||
        location.pathname.toLowerCase() !== ${JSON.stringify(path.toLowerCase())}) return;
    const dialogs = matches(document, '[role="dialog"],dialog[open]');
    const dialog = dialogs.length === 1 ? dialogs[0] : null;
    const button = (root, labels) => named(root, ${JSON.stringify(buttons)}, labels);
    const heading = (root, labels) => named(root, 'h1,h2,h3,h4,[role="heading"]', labels).length === 1;
    const mark = nodes => {
      if (nodes.length !== 1) return;
      document.querySelectorAll('[${marker}]').forEach(el => el.removeAttribute('${marker}'));
      nodes[0].setAttribute('${marker}', 'true'); return true;
    };
    ${body}
  })()`;
}

async function inspect<T>(context: BrowserRecipeContext, expression: string) {
  const value = await context.waitFor<T>(expression, 10_000);
  await checkInstagramOwner(context);
  if (value === undefined) throw new SocialPlatformError("unsupported");
  return value;
}

async function visibleHighlights(context: BrowserRecipeContext, profile: string) {
  return inspect<InstagramHighlights>(
    context,
    probe(
      profile,
      `
    if (dialogs.length || !(${ownerProfileProof})) return;
    const main = document.querySelector('main');
    if (!main) return;
    const items = new Map();
    for (const anchor of matches(main, 'a[href]').slice(0, 500)) {
      const url = new URL(anchor.href);
      const id = url.origin === location.origin && !url.search && !url.hash &&
        new RegExp(${JSON.stringify(highlightsPath)}).exec(url.pathname)?.[1];
      if (!id) continue;
      const name = clean(anchor.textContent) || clean(anchor.getAttribute('aria-label'));
      if (!name || [...name].length > 100 || (items.has(id) && items.get(id).name !== name)) return;
      items.set(id, { id, name });
    }
    if (!items.size && button(main, ${JSON.stringify(createLabels)}).length !== 1) return;
    return { items: [...items.values()].slice(0, ${MAX_HIGHLIGHTS}), partial: true };
  `,
    ),
  );
}

/** Gives the owner an on-demand snapshot of the Highlights visible on their own profile. */
export async function readInstagramHighlights(
  context: BrowserRecipeContext,
): Promise<InstagramHighlights> {
  return visibleHighlights(context, await openInstagramOwnerProfile(context));
}

const titleInput = [
  'input[type="text"][placeholder="Highlight name"]',
  'input[aria-label="Highlight name"]',
  'input[placeholder="Highlights name"]',
  'input[placeholder="Name"]',
  'input[placeholder="Öne çıkan adı"]',
  'input[aria-label="Öne çıkan adı"]',
].join(",");
const titleProbe = `
  if (!dialog || !heading(dialog, ${JSON.stringify(dialogHeadings)})) return;
  const fields = matches(dialog, ${JSON.stringify(titleInput)}).filter(el => !el.disabled && !el.readOnly);
`;
const storyProbe = String.raw`
  if (!dialog || !heading(dialog, ['Select stories','Stories','Add stories','Edit highlight','Edit Highlight','New highlight','New Highlight','Hikayeler','Hikayeleri seç','Öne çıkanı düzenle'])) return;
  const picks = matches(dialog, 'input[type="checkbox"],[role="checkbox"]');
  if (!picks.length || picks.length > 150) return;
  const stories = new Map();
  for (const pick of picks) {
    const container = pick.closest('[data-story-id],label,[role="option"]') || pick;
    const link = container.querySelector('a[href]');
    const url = link && new URL(link.href);
    const id = pick.getAttribute('data-story-id') || container.getAttribute('data-story-id') ||
      (url?.origin === location.origin && !url.search && !url.hash &&
        /^\/stories\/[A-Za-z0-9_.]+\/(\d{1,30})\/?$/.exec(url.pathname)?.[1]);
    const flag = pick.getAttribute('aria-checked');
    if (!/^\d{1,30}$/.test(id || '') || stories.has(id) || pick.disabled ||
        pick.getAttribute('aria-disabled') === 'true' ||
        (pick.tagName !== 'INPUT' && !['true','false'].includes(flag))) return;
    stories.set(id, { pick, checked: pick.tagName === 'INPUT' ? pick.checked : flag === 'true' });
  }
`;

/** Changes a reviewed owned collection. A submitted click with ambiguous acknowledgement is held for inspection. */
export async function changeInstagramHighlight(
  context: BrowserRecipeContext,
  change: InstagramHighlightChange,
  beforeSubmission: () => Promise<void>,
) {
  const profile = await openInstagramOwnerProfile(context);
  const previous = await visibleHighlights(context, profile);
  const selected: InstagramHighlight | undefined =
    "id" in change ? previous.items.find(({ id }) => id === change.id) : undefined;
  if ("id" in change && selected?.name !== change.expectedName)
    throw new SocialPlatformError("denied");
  if (change.action === "create" && previous.items.some(({ name }) => name === change.name))
    throw new SocialPlatformError("rejected");
  let view = selected ? `/stories/highlights/${selected.id}/` : profile;
  let submitted = false;

  async function click(path: string, body: string, final = false) {
    await inspect<boolean>(context, probe(path, body));
    if (final) {
      await beforeSubmission();
      // Resolve the control after waiting for pacing and recheck the account before clicking it.
      await inspect<boolean>(context, probe(path, body));
      submitted = true;
    }
    await context.page.click(target);
  }

  async function openMenu() {
    await click(
      view,
      `
      if (dialogs.length) return;
      return mark(button(document, ['More options','Options','Diğer seçenekler','Seçenekler']));
    `,
    );
  }

  async function openEdit() {
    await openMenu();
    await click(
      view,
      `
      if (!dialog) return;
      return mark(button(dialog, ${JSON.stringify(editLabels)}));
    `,
    );
  }

  async function writeTitle(name: string, expected?: string) {
    const old = await inspect<{ name: string }>(
      context,
      probe(
        view,
        `
      ${titleProbe}
      if (!mark(fields)) return;
      return { name: fields[0].value };
    `,
      ),
    );
    if (expected !== undefined && old.name !== expected) throw new SocialPlatformError("denied");
    if (old.name !== name) await context.page.fill(target, name);
  }

  async function setStories(ids: string[]) {
    const desired = JSON.stringify(ids);
    const toggles = await inspect<string[]>(
      context,
      probe(
        view,
        `
      ${storyProbe}
      const wanted = new Set(${desired});
      if ([...wanted].some(id => !stories.has(id))) return;
      return [...stories].filter(([id, story]) => story.checked !== wanted.has(id)).map(([id]) => id);
    `,
      ),
    );
    for (const id of toggles) {
      await click(
        view,
        `
        ${storyProbe}
        const story = stories.get(${JSON.stringify(id)});
        if (!story || story.checked === ${ids.includes(id)}) return;
        return mark([story.pick]);
      `,
      );
    }
    await verifyStories(ids);
  }

  const verifyStories = (ids: string[]) =>
    inspect<boolean>(
      context,
      probe(
        view,
        `
      ${storyProbe}
      const wanted = new Set(${JSON.stringify(ids)});
      if ([...wanted].some(id => !stories.has(id))) return;
      if ([...stories].every(([id, story]) => story.checked === wanted.has(id))) return true;
    `,
      ),
    );

  const chooseStoriesTab = () =>
    click(
      view,
      `
      if (!dialog || !heading(dialog, ${JSON.stringify(dialogHeadings)})) return;
      return mark(named(dialog, 'button,[role="button"],[role="tab"]', ['Stories','Hikayeler']));
    `,
    );

  async function refreshed() {
    await context.page.goto(`${INSTAGRAM_ORIGIN}${profile}`);
    await requireInstagramOwnerProfile(context, profile);
    return visibleHighlights(context, profile);
  }

  try {
    if (selected) {
      await context.page.goto(`${INSTAGRAM_ORIGIN}${view}`);
      await checkInstagramOwner(context);
    }
    if (change.action === "delete") {
      await openMenu();
      await click(
        view,
        `
        if (!dialog) return;
        return mark(button(dialog, ${JSON.stringify(deleteLabels)}));
      `,
      );
      await click(
        view,
        `
        if (!dialog || !heading(dialog, ['Delete highlight?','Delete Highlight?','Öne çıkan silinsin mi?'])) return;
        const titles = matches(dialog, 'h1,h2,h3,p,[role="heading"]').filter(el =>
          clean(el.textContent) === ${JSON.stringify(selected!.name)});
        if (!titles.length) return;
        return mark(button(dialog, ['Delete','Delete highlight','Sil','Öne çıkanı sil']));
      `,
        true,
      );
      const receipt = await context.waitFor<boolean>(
        `(() => {
        ${instagramControls}
        return location.origin === ${JSON.stringify(INSTAGRAM_ORIGIN)} &&
          named(document, '[role="status"],[role="alert"]', ['Highlight deleted','Öne çıkan silindi']).length === 1;
      })()`,
        10_000,
      );
      if (!receipt || (await refreshed()).items.some(({ id }) => id === change.id))
        throw new SocialPlatformError("unknown");
      return { changed: true };
    }

    if (change.action === "create") {
      await click(
        profile,
        `
        if (dialogs.length || !(${ownerProfileProof})) return;
        const main = document.querySelector('main');
        if (!main) return;
        return mark(button(main, ${JSON.stringify(createLabels)}));
      `,
      );
      await writeTitle(change.name);
      await click(
        view,
        `
        ${titleProbe}
        if (fields.length !== 1 || fields[0].value !== ${JSON.stringify(change.name)}) return;
        return mark(button(dialog, ['Next','İleri']));
      `,
      );
      await setStories(change.storyIds);
      await click(
        view,
        `
        ${storyProbe}
        return mark(button(dialog, ['Next','İleri']));
      `,
      );
      await click(
        view,
        `
        if (!dialog || !heading(dialog, ['Edit cover','Cover','Kapağı düzenle','Kapak'])) return;
        return mark(button(dialog, ['Done','Bitti']));
      `,
        true,
      );
    } else {
      await openEdit();
      await writeTitle(change.name, selected!.name);
      if (change.storyIds) {
        await chooseStoriesTab();
        await setStories(change.storyIds);
      }
      await click(
        view,
        `
        ${
          change.storyIds
            ? `${storyProbe}
            const wanted = new Set(${JSON.stringify(change.storyIds)});
            if ([...wanted].some(id => !stories.has(id)) ||
                [...stories].some(([id, story]) => story.checked !== wanted.has(id))) return;`
            : `${titleProbe}
            if (fields.length !== 1 || fields[0].value !== ${JSON.stringify(change.name)}) return;`
        }
        return mark(button(dialog, ['Done','Save','Bitti','Kaydet']));
      `,
        true,
      );
    }

    // Wait for the editor to close before reading the persisted profile.
    const closed = await context.waitFor<boolean>(
      `(() => {
      ${instagramControls}
      return location.origin === ${JSON.stringify(INSTAGRAM_ORIGIN)} &&
        matches(document, '[role="dialog"],dialog[open]').length === 0;
    })()`,
      10_000,
    );
    if (!closed) throw new SocialPlatformError("unknown");
    const candidates = (await refreshed()).items.filter(
      ({ id, name }) =>
        name === change.name &&
        (selected ? id === selected.id : !previous.items.some((item) => item.id === id)),
    );
    if (candidates.length !== 1) throw new SocialPlatformError("unknown");
    if (change.storyIds) {
      view = `/stories/highlights/${candidates[0].id}/`;
      await context.page.goto(`${INSTAGRAM_ORIGIN}${view}`);
      await checkInstagramOwner(context);
      await openEdit();
      await chooseStoriesTab();
      await verifyStories(change.storyIds);
    }
    return { changed: true };
  } catch (error) {
    if (submitted) throw new SocialPlatformError("unknown");
    throw error;
  }
}
