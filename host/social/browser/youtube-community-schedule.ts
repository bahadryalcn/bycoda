import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { isoTimestamp } from "../../../src/shared/lib/time/timestamps";
import { click, control, json } from "../social-browser-publishing-shared";
import type { BrowserRecipeContext } from "../social-browser-recipe";
import { youtubeCommunityDialog } from "./youtube-community-posts";
import { verifyYouTubeBrowser, youtubeBrowserScreenError } from "./youtube-recipe-guards";

const scheduleDialog =
  "ytd-backstage-post-schedule-dialog-renderer, tp-yt-paper-dialog#schedule-dialog";
const inside = (selector: string) =>
  scheduleDialog
    .split(", ")
    .map((root) => `${root} ${selector}`)
    .join(",");
const utcLabels = [
  "UTC",
  "Etc/UTC",
  "GMT",
  "GMT+00:00",
  "(GMT+00:00) Coordinated Universal Time",
  "Coordinated Universal Time",
];

export function communityScheduleTime(value: unknown): string | undefined {
  if (value === undefined) return;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(value))
    throw new SocialPlatformError("rejected");
  const canonical = isoTimestamp(value);
  if (!canonical || canonical.slice(0, 16) !== value.slice(0, 16))
    throw new SocialPlatformError("rejected");
  return canonical;
}

/** Fill only a uniquely scoped date/time field with a recognized native type or format. */
async function scheduleField(ctx: BrowserRecipeContext, kind: "date" | "time", value: string) {
  const target = await control(
    ctx,
    inside(`input:is([type="${kind}"],#${kind}-input,[name="${kind}"])`),
    `community-schedule-${kind}`,
  );
  const shape = await ctx.page.evaluate<{ type: string; placeholder: string }>(
    String.raw`(() => {const el=document.querySelector(${json(target)});return el?{type:el.type,placeholder:el.placeholder}:undefined;})()`,
  );
  let formatted = value;
  if (shape?.type === "text") {
    const placeholder = shape.placeholder.toUpperCase().trim();
    if (kind === "date" && (placeholder === "MM/DD/YYYY" || placeholder === "DD/MM/YYYY")) {
      const [year, month, day] = value.split("-");
      formatted =
        placeholder === "MM/DD/YYYY" ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
    } else if (kind === "time" && (placeholder === "H:MM AM/PM" || placeholder === "HH:MM AM/PM")) {
      const [rawHour, minute] = value.split(":");
      const hour = Number(rawHour);
      formatted = `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
    } else if (placeholder !== (kind === "date" ? "YYYY-MM-DD" : "HH:MM")) {
      throw await youtubeBrowserScreenError(ctx);
    }
  } else if (shape?.type !== kind) {
    throw await youtubeBrowserScreenError(ctx);
  }
  await verifyYouTubeBrowser(ctx);
  if (shape.type === kind) {
    // Native segmented inputs do not accept a complete ISO value via the browser's insertText.
    await ctx.page.evaluate(String.raw`(() => {
      const el=document.querySelector(${json(target)});
      if(el instanceof HTMLInputElement&&el.type===${json(kind)}&&!el.disabled&&!el.readOnly){
        el.value=${json(formatted)};
        el.dispatchEvent(new Event("input",{bubbles:true}));
        el.dispatchEvent(new Event("change",{bubbles:true}));
      }
    })()`);
  } else {
    await ctx.page.fill(target, formatted);
  }
  return { kind, formatted };
}

/** UTC is explicitly selected so a remote browser's local time cannot shift a publication. */
async function selectUtc(ctx: BrowserRecipeContext) {
  const selector = inside('select:is(#time-zone,#timezone,#timezone-select,[name="timezone"])');
  const native = await ctx.page.evaluate<boolean>(`!!document.querySelector(${json(selector)})`);
  if (native) {
    const target = await control(ctx, selector, "community-time-zone");
    await verifyYouTubeBrowser(ctx);
    const selected = await ctx.page.evaluate<boolean>(String.raw`(() => {
      const select=document.querySelector(${json(target)});
      if(!(select instanceof HTMLSelectElement)||select.disabled)return false;
      const labels=${json(utcLabels)};
      const options=[...select.options].filter(el=>!el.disabled&&(labels.includes(el.value)||labels.includes(el.textContent.trim())));
      if(options.length!==1)return false;
      select.value=options[0].value;
      select.dispatchEvent(new Event("input",{bubbles:true}));
      select.dispatchEvent(new Event("change",{bubbles:true}));
      return select.value===options[0].value;
    })()`);
    if (!selected) throw await youtubeBrowserScreenError(ctx);
    return selector;
  }
  const trigger = inside(
    ':is(#time-zone,#timezone,#timezone-select):is(button,[role="button"],[role="combobox"])',
  );
  await click(ctx, trigger, "community-time-zone");
  await click(
    ctx,
    'tp-yt-paper-listbox [role="option"],tp-yt-paper-listbox tp-yt-paper-item,[role="listbox"] [role="option"]',
    "community-utc-option",
    utcLabels,
  );
  return trigger;
}

export async function prepareCommunitySchedule(ctx: BrowserRecipeContext, publishAt: string) {
  await click(
    ctx,
    `${youtubeCommunityDialog} :is(#schedule-button,#schedule-menu-button,#dropdown-trigger) button,${youtubeCommunityDialog} button:is(#schedule-button,#schedule-menu-button,#dropdown-trigger)`,
    "community-open-schedule",
    [
      "Post options",
      "Scheduling options",
      "Schedule post",
      "Schedule Post",
      "Gönderi seçenekleri",
      "Gönderiyi planla",
    ],
  );
  await click(
    ctx,
    'ytd-menu-popup-renderer ytd-menu-service-item-renderer,ytd-menu-popup-renderer [role="menuitem"],tp-yt-paper-listbox tp-yt-paper-item',
    "community-schedule-post",
    ["Schedule post", "Schedule Post", "Gönderiyi planla"],
  );
  const timezone = await selectUtc(ctx);
  const date = await scheduleField(ctx, "date", publishAt.slice(0, 10));
  const time = await scheduleField(ctx, "time", publishAt.slice(11, 16));
  const exact = await ctx.page.evaluate<boolean>(String.raw`(() => {
    const field=(kind)=>[...document.querySelectorAll(${json(scheduleDialog)})].flatMap(root=>[...root.querySelectorAll('input:is([type="'+kind+'"],#'+kind+'-input,[name="'+kind+'"])')]).filter(el=>!el.hidden&&el.getClientRects().length);
    const dates=field("date"),times=field("time");
    const controls=[...document.querySelectorAll(${json(timezone)})].filter(el=>!el.hidden&&el.getClientRects().length);
    if(dates.length!==1||times.length!==1||controls.length!==1)return false;
    const zone=controls[0],labels=${json(utcLabels)};
    const inUtc=zone instanceof HTMLSelectElement
      ? labels.includes(zone.value)||labels.includes(zone.selectedOptions[0]?.textContent.trim())
      : [zone.getAttribute('data-value'),zone.getAttribute('aria-valuetext'),zone.textContent.trim()].some(value=>labels.includes(value));
    return inUtc&&dates[0].value===${json(date.formatted)}&&times[0].value===${json(time.formatted)};
  })()`);
  if (!exact) throw await youtubeBrowserScreenError(ctx);
  return await control(
    ctx,
    inside(':is(#schedule-button,#submit-button,#confirm-button):is(button,[role="button"])') +
      "," +
      inside(":is(#schedule-button,#submit-button,#confirm-button) button"),
    "community-submit-schedule",
    ["Schedule", "Planla"],
  );
}
