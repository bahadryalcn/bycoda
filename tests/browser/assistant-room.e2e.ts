import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`quiet Room redesign preserves every section ${theme} ${width}`,async({page})=>{
  const output=join(process.cwd(),"temp/verification/assistant-room-redesign");await mkdir(output,{recursive:true});
  await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:"reduce"});
  const capture=async(name:string)=>{await expect(page.locator("body")).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({animations:"disabled",path:join(output,`${theme}-${width}-${name}.png`)});};
  await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&redesign`);
  const room=page.getByRole("main");await expect(room.getByRole("heading",{name:"Arif",exact:true})).toBeVisible();
  await expect(room.getByText("Work tracking continues while voice is off.",{exact:true})).toHaveCount(0);
  await capture("today");
  await room.getByRole("button",{name:"Assistant status",exact:true}).click();await capture("health");await page.keyboard.press("Escape");
  await room.getByRole("button",{name:"Presence",exact:true}).click();await capture("presence");await page.keyboard.press("Escape");
  for(const tab of ["Conversations","Jobs","Sessions","Notes","History","Memory"]){await room.getByRole("tab",{name:new RegExp(`^${tab}`)}).click();await capture(tab.toLowerCase());}
  await room.getByRole("button",{name:"Add memory",exact:true}).click();await capture("memory-editor");await page.getByRole("dialog",{name:"Add memory",exact:true}).getByRole("button",{name:"Cancel",exact:true}).click();
  await room.getByRole("tab",{name:"Notes",exact:true}).click();await room.getByRole("button",{name:"New note",exact:true}).click();const note=page.getByRole("dialog",{name:"New note",exact:true});await note.getByRole("textbox",{name:"Title",exact:true}).fill("Retained owner draft");await capture("note-editor");await note.getByRole("button",{name:"Cancel",exact:true}).click();
  await room.getByRole("tab",{name:/^Jobs/}).click();await room.getByRole("button",{name:"Improve session recovery",exact:true}).click();await capture("job-detail");await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
  const draft=room.getByRole("textbox",{name:"Give Arif a job",exact:true});await draft.fill("Review the saved release draft");await room.getByRole("button",{name:"Review jobs",exact:true}).click();await capture("job-review");await page.getByRole("dialog",{name:"Review jobs",exact:true}).getByRole("button",{name:"Cancel",exact:true}).click();
  await room.getByRole("tab",{name:"Notes",exact:true}).click();await room.getByRole("tab",{name:/^Jobs/}).click();await expect(draft).toHaveValue("Review the saved release draft");
  await room.getByRole("button",{name:"Settings",exact:true}).click();const settings=page.getByRole("dialog",{name:"Settings · Arif",exact:true});await capture("settings");
  for(const section of ["Autonomy","Presence and hours","Cost and context","Manual session supervision","Computer use","Conversation retention","Today's usage"]){
   const summary=settings.locator("summary").filter({hasText:new RegExp(`^${section.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}$`)});await summary.click();await summary.scrollIntoViewIfNeeded();await capture(`settings-${section.toLowerCase().replace(/[^a-z]+/g,"-")}`);await summary.click();
  }
  await settings.getByRole("button",{name:"Close",exact:true}).click();await room.getByRole("button",{name:"More options",exact:true}).click();await page.getByRole("menuitem",{name:"Recently deleted",exact:true}).click();await capture("recently-deleted");await page.getByRole("dialog",{name:"Recently deleted",exact:true}).getByRole("button",{name:"Close",exact:true}).click();
  await page.evaluate(()=>localStorage.clear());await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&redesign-empty`);
  for(const tab of ["Today","Conversations","Jobs","Sessions","Notes","History","Memory"]){await page.getByRole("tab",{name:new RegExp(`^${tab}`)}).click();await capture(`empty-${tab.toLowerCase()}`);}
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`conversation summary explicit recovery ${theme} ${width}`,async({page})=>{
  const output="temp/verification/arif-assistant-room";await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});
  await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&summary-refresh=1`);
  await page.getByRole("tab",{name:"Conversations",exact:true}).click();await expect(page.getByText("Updating conversation summary",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__summaryRefreshRequests)).toBeUndefined();
  await page.getByRole("button",{name:"Conversation actions",exact:true}).click();
  await page.screenshot({animations:"disabled",path:join(output,`summary-pending-menu-${theme}-${width}.png`)});
  await page.getByRole("menuitem",{name:"Refresh conversation summary",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:"Summary refresh was not confirmed."})).toBeVisible();
  await page.getByRole("button",{name:"Conversation actions",exact:true}).click();await expect(page.getByRole("menuitem",{name:"Retry summary refresh",exact:true})).toBeEnabled();
  await page.screenshot({animations:"disabled",path:join(output,`summary-lost-ack-menu-${theme}-${width}.png`)});
  await page.getByRole("menuitem",{name:"Retry summary refresh",exact:true}).click();
  await expect(page.getByRole("alert").filter({hasText:"Summary refresh was not confirmed."})).toHaveCount(0);
  const replay=await page.evaluate(()=>(window as any).__summaryRefreshRequests);expect(replay).toHaveLength(2);expect(replay[0]).toEqual(replay[1]);expect(await page.evaluate(()=>(window as any).__summaryRefreshMutations)).toBe(1);
  await page.getByRole("button",{name:"Conversation actions",exact:true}).click();await page.getByRole("menuitem",{name:"Refresh conversation summary",exact:true}).click();
  await expect(page.getByText("Conversation summary is waiting. Check its settings or refresh it.",{exact:true})).toBeVisible();await page.screenshot({animations:"disabled",path:join(output,`summary-blocked-${theme}-${width}.png`)});
  await page.getByRole("button",{name:"Conversation actions",exact:true}).click();await page.getByRole("menuitem",{name:"Refresh conversation summary",exact:true}).click();
  await expect(page.getByText("A verified conversation summary is available.",{exact:true})).toBeVisible();await page.screenshot({animations:"disabled",path:join(output,`summary-ready-${theme}-${width}.png`)});
  const all=await page.evaluate(()=>(window as any).__summaryRefreshRequests);expect(all).toHaveLength(4);expect(new Set(all.map((item:any)=>item.requestId)).size).toBe(3);
  await expect(page.getByText("Private fixture diagnostic must never appear",{exact:true})).toHaveCount(0);await expect(page.getByText("Private fixture summary must never appear",{exact:true})).toHaveCount(0);
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`pending voice question presentation ${theme} ${width}`,async({page})=>{
  const output="temp/verification/arif-assistant-room";await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&question-presentation=1`);
  const pending=page.getByRole("article").filter({hasText:"Saving this question is unconfirmed. Retry to verify the original card."});await expect(pending).toBeVisible();expect(await page.evaluate(()=>(window as any).__presentationRequest)).toBeUndefined();
  await pending.screenshot({animations:"disabled",path:join(output,`question-presentation-pending-${theme}-${width}.png`)});await pending.getByRole("button",{name:"Retry",exact:true}).click();await expect(pending).toHaveCount(0);
  const recovered=page.getByRole("article",{name:"Retained planning choice",exact:true});await expect(recovered.getByRole("radio",{name:/Preserve the existing scope/})).toBeVisible();expect(await page.evaluate(()=>(window as any).__presentationRequest)).toMatchObject({requestId:"pending-voice-presentation",threadId:"thread-one",ownerMessageId:"pending-owner",causalContextId:"fixture-captured-context"});
  await recovered.screenshot({animations:"disabled",path:join(output,`question-presentation-recovered-${theme}-${width}.png`)});
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`saved assistant policy ${theme} ${width}`,async({page})=>{
  const output="temp/verification/arif-assistant-room";await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&policy=1`);
  await page.getByRole("button",{name:"Settings",exact:true}).click();const dialog=page.getByRole("dialog");
  const presence=dialog.locator("section").filter({has:page.getByRole("heading",{name:"Presence and hours",exact:true})});
  await expect(presence.getByRole("spinbutton",{name:"Work hours start",exact:true})).toHaveValue("22");await expect(presence.getByRole("spinbutton",{name:"Work hours end",exact:true})).toHaveValue("6");
  await presence.screenshot({animations:"disabled",path:join(output,`policy-presence-${theme}-${width}.png`)});
  const cost=dialog.locator("section").filter({has:page.getByRole("heading",{name:"Cost and context",exact:true})});
  await expect(cost.getByRole("spinbutton",{name:"Follow-ups before worker recovery",exact:true})).toHaveValue("0");
  await cost.screenshot({animations:"disabled",path:join(output,`policy-cost-${theme}-${width}.png`)});
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`persistent owner question ${theme} ${width}`,async({page})=>{
  page.setDefaultTimeout(15000);const output="temp/verification/arif-assistant-room";await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});
  await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&owner-questions=1`);
  const card=page.getByRole("article",{name:"Recovery scope",exact:true});await expect(card).toBeVisible();
  await page.locator('[aria-label="Questions waiting for you"]').screenshot({animations:"disabled",path:join(output,`owner-question-open-${theme}-${width}.png`)});
  await card.getByRole("radio",{name:/Small safe change/}).check();await card.locator('button[type="submit"]').click();await expect(card).toHaveCount(0);
  const voice=page.getByRole("article",{name:"Saved voice choice",exact:true});await voice.getByRole("button",{name:"Later",exact:true}).click();await expect(voice.getByText(/Snoozed until/)).toBeVisible();
  await voice.screenshot({animations:"disabled",path:join(output,`owner-question-later-${theme}-${width}.png`)});
  await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&owner-questions=1&question-lost=1`);
  const pending=page.getByRole("article",{name:"Recovery scope",exact:true});await pending.getByRole("radio",{name:/Small safe change/}).check();await pending.locator('button[type="submit"]').click();
  await expect(pending.getByText("The answer is unconfirmed. Your original choice is kept.",{exact:true})).toBeVisible();
  await pending.screenshot({animations:"disabled",path:join(output,`owner-question-unknown-${theme}-${width}.png`)});
  await pending.getByRole("button",{name:"Retry",exact:true}).click();await expect(pending).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__ownerQuestionMutations)).toBe(1);
 });

for(const theme of ["light","dark"])for(const width of [1280,800]){
 test(`job task deletion review ${theme} ${width}`,async({page})=>{
  page.setDefaultTimeout(15000);const output="temp/verification/arif-assistant-room";await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&delete-bundle=1`);
  await page.getByRole("tab",{name:/^Jobs(?: \d+)?$/}).click();await page.getByRole("button",{name:"Job actions",exact:true}).click();await page.getByRole("menuitem",{name:"Delete...",exact:true}).click();const review=page.getByRole("dialog",{name:"Delete job?",exact:true});await expect(review.getByRole("checkbox",{name:"Also delete the reviewed tasks",exact:true})).not.toBeChecked();await expect(review).toContainText("Verify the provider handoff contract");
  await page.screenshot({animations:"disabled",path:join(output,`task-delete-default-${theme}-${width}.png`)});await review.getByRole("checkbox",{name:"Also delete the reviewed tasks",exact:true}).check();await page.screenshot({animations:"disabled",path:join(output,`task-delete-selected-${theme}-${width}.png`)});await review.getByRole("button",{name:"Delete job and tasks",exact:true}).click();await expect(review).toContainText("Original retirement is unknown");await page.screenshot({animations:"disabled",path:join(output,`task-delete-uncertain-${theme}-${width}.png`)});
  await review.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"Keep job and tasks",exact:true}).click();await page.getByRole("button",{name:"Review tasks",exact:true}).click();await expect(page.locator("body")).toHaveAttribute("data-reviewed-job-environment","fixture-local-host");await page.getByRole("button",{name:"Job actions",exact:true}).click();await expect(page.getByRole("menuitem",{name:"Resume",exact:true})).toHaveCount(0);await page.keyboard.press("Escape");await page.screenshot({animations:"disabled",path:join(output,`task-delete-kept-${theme}-${width}.png`)});
 });
 test(`job task deletion restore ${theme} ${width}`,async({page})=>{
  page.setDefaultTimeout(15000);const output="temp/verification/arif-assistant-room";await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&delete-bundle=1&delete-success=1`);await page.getByRole("tab",{name:/^Jobs(?: \d+)?$/}).click();await page.getByRole("button",{name:"Job actions",exact:true}).click();await page.getByRole("menuitem",{name:"Delete...",exact:true}).click();const review=page.getByRole("dialog",{name:"Delete job?",exact:true});await review.getByRole("checkbox",{name:"Also delete the reviewed tasks",exact:true}).check();await review.getByRole("button",{name:"Delete job and tasks",exact:true}).click();await expect(review).toHaveCount(0);
  await page.getByRole("button",{name:"More options",exact:true}).click();await page.getByRole("menuitem",{name:"Recently deleted",exact:true}).click();const trash=page.getByRole("dialog",{name:"Recently deleted",exact:true});await expect(trash).toContainText("Includes 2 deleted tasks. Restoring keeps them stopped.");await page.screenshot({animations:"disabled",path:join(output,`task-delete-trash-${theme}-${width}.png`)});await trash.getByRole("button",{name:"Restore",exact:true}).last().click();await trash.getByRole("button",{name:"Close",exact:true}).click();await expect(page.getByRole("button",{name:"Review tasks",exact:true})).toBeVisible();await page.screenshot({animations:"disabled",path:join(output,`task-delete-restored-${theme}-${width}.png`)});
 });
 test(`job task deletion Voice confirmation ${theme} ${width}`,async({page})=>{
  page.setDefaultTimeout(15000);const output="temp/verification/arif-assistant-room";await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&voice-delete=1`);await expect(page.getByText("2 tasks. Sessions, branches and working files remain. Project: MonoCode, Backend",{exact:true})).toBeVisible();await page.screenshot({animations:"disabled",path:join(output,`task-delete-voice-${theme}-${width}.png`)});
  await page.getByRole("radio",{name:"Delete job and tasks",exact:true}).check();await page.getByRole("button",{name:"Send answer",exact:true}).click();await expect(page.locator("body")).toHaveAttribute("data-deletion-decision","confirm");
 });
}

for(const theme of ["light","dark"])for(const width of [1280,800]){
 test(`scheduled automation Room ${theme} ${width}`,async({page})=>{
  const output="temp/verification/arif-assistant-room";await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});
  await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&quick-automation=1`);
  page.setDefaultTimeout(15000);await page.getByRole("textbox",{name:"Give Arif a job",exact:true}).fill("Create a scheduled morning review");await page.getByRole("button",{name:"Review jobs",exact:true}).click();const review=page.getByRole("dialog",{name:"Review jobs",exact:true});
  await review.getByRole("button",{name:"Job type: Project work",exact:true}).click();await page.getByRole("option",{name:"Create scheduled automation",exact:true}).click();
  await expect(review.getByRole("button",{name:"Create automations",exact:true})).toBeDisabled();await review.getByRole("button",{name:"Choose a provider and model",exact:true}).click();
  await review.getByRole("textbox",{name:"Automation prompt",exact:true}).fill("Summarize the actual project changes and outstanding questions. Do not publish anything.");
  await page.screenshot({animations:"disabled",path:join(output,`automation-review-${theme}-${width}.png`)});
  await review.getByRole("spinbutton",{name:"Run time limit (minutes)",exact:true}).fill("45");await review.getByRole("spinbutton",{name:"Runs per day",exact:true}).fill("2");
  await review.getByText("This creates a scheduled automation. It does not run it now.",{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({animations:"disabled",path:join(output,`automation-schedule-${theme}-${width}.png`)});
  await review.getByRole("button",{name:"Create automations",exact:true}).click();await expect(review.getByRole("alert")).toContainText("Automation receipt lost after commit");await expect(page.locator("body")).toHaveAttribute("data-automation-creates","1");
  await review.getByRole("button",{name:"Check and retry",exact:true}).scrollIntoViewIfNeeded();await page.screenshot({animations:"disabled",path:join(output,`automation-uncertain-${theme}-${width}.png`)});await review.getByRole("button",{name:"Check and retry",exact:true}).click();await expect(review).toHaveCount(0);await expect(page.locator("body")).toHaveAttribute("data-automation-creates","1");
  await page.getByRole("tab",{name:/^Jobs(?: \d+)?$/}).click();await page.getByRole("button",{name:"Create a scheduled morning review",exact:true}).click();const detail=page.getByRole("dialog",{name:"Create a scheduled morning review",exact:true});await expect(detail).toContainText("Automation created");await expect(detail.getByRole("spinbutton",{name:"Run time limit (minutes)",exact:true})).toHaveValue("45");await detail.getByRole("button",{name:"Open automation",exact:true}).click();await expect(page.locator("body")).toHaveAttribute("data-automation-environment","fixture-local-host");
  await detail.getByText("Automation created",{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({animations:"disabled",path:join(output,`automation-details-${theme}-${width}.png`)});
 });
 test(`scheduled automation Voice review ${theme} ${width}`,async({page})=>{
  const output="temp/verification/arif-assistant-room";await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&voice-jobs=1`);
  await page.getByRole("button",{name:"Job type: Project work",exact:true}).click();await page.getByRole("option",{name:"Create scheduled automation",exact:true}).click();await expect(page.getByRole("button",{name:"Create automations",exact:true})).toBeDisabled();await page.getByRole("button",{name:"Choose a provider and model",exact:true}).click();
  await page.screenshot({animations:"disabled",path:join(output,`automation-voice-review-${theme}-${width}.png`)});await page.getByText("This creates a scheduled automation. It does not run it now.",{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({animations:"disabled",path:join(output,`automation-voice-schedule-${theme}-${width}.png`)});
  await page.getByRole("button",{name:"Create automations",exact:true}).click();await expect(page.getByRole("alert")).toContainText("Job status is unknown");await expect(page.getByRole("textbox",{name:"Automation prompt",exact:true})).toBeDisabled();await page.getByRole("button",{name:"Check and retry",exact:true}).scrollIntoViewIfNeeded();await page.screenshot({animations:"disabled",path:join(output,`automation-voice-uncertain-${theme}-${width}.png`)});
 });
}

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`utility output and worker context settings ${theme} ${width}`,async({page})=>{
  const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});
  await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}`);
  await page.getByRole("button",{name:"Settings",exact:true}).click();const dialog=page.getByRole("dialog");
  const cost=dialog.locator("section").filter({has:page.getByRole("heading",{name:"Cost and context",exact:true})});
  await cost.scrollIntoViewIfNeeded();await expect(cost.getByText(/Claude utility requests include/)).toBeVisible();
  await cost.screenshot({animations:"disabled",path:join(output,`output-context-compact-${theme}-${width}.png`)});
  await cost.getByRole("button",{name:"Advanced worker context limits",exact:true}).click();
  const soft=cost.getByRole("spinbutton",{name:"Compact worker context at (tokens)",exact:true});
  await expect(soft).toHaveValue("150000");await expect(cost.getByRole("spinbutton",{name:"Continue workers in a fresh session at (%)",exact:true})).toHaveValue("80");
  await soft.fill("160000");await soft.blur();
  await cost.screenshot({animations:"disabled",path:join(output,`output-context-advanced-${theme}-${width}.png`)});
  await dialog.getByRole("button",{name:"Save",exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole("button",{name:"Settings",exact:true}).click();await dialog.getByRole("button",{name:"Advanced worker context limits",exact:true}).click();
  await expect(dialog.getByRole("spinbutton",{name:"Compact worker context at (tokens)",exact:true})).toHaveValue("160000");
  await expect(dialog.getByRole("spinbutton",{name:"Compact context at",exact:true})).toHaveValue("150000");
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`multi-project voice review ${theme} ${width}`,async({page})=>{
  page.setDefaultTimeout(15000);const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});
  await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&voice-jobs=1`);
  await page.getByRole("button",{name:/^Participating projects/}).click();const menu=page.getByRole("dialog",{name:"Participating projects options",exact:true});
  await menu.getByRole("option",{name:/Backend/}).click();await menu.getByRole("button",{name:"Done",exact:true}).click();
  await page.getByRole("button",{name:/^Lead project/}).click();await page.getByRole("option",{name:/Backend/}).click();
  await page.screenshot({animations:"disabled",path:join(output,`multi-voice-review-${theme}-${width}.png`)});
  await page.getByRole("button",{name:"Start jobs",exact:true}).click();await expect(page.getByRole("textbox",{name:"Title",exact:true})).toBeDisabled();
  await page.screenshot({animations:"disabled",path:join(output,`multi-voice-retry-${theme}-${width}.png`)});
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`multi-project job review ${theme} ${width}`,async({page})=>{
  page.setDefaultTimeout(15000);const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});
  await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&multi=1`);
  await page.getByRole("tab",{name:/^Jobs(?: \d+)?$/}).click();
  await page.getByRole("textbox",{name:"Give Arif a job",exact:true}).fill("Coordinate frontend and backend");
  await page.getByRole("button",{name:"Review jobs",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Review jobs",exact:true});
  await dialog.getByRole("button",{name:/^Participating projects/}).click();
  const options=page.getByRole("dialog",{name:"Participating projects options",exact:true});
  await options.getByRole("option",{name:/Backend/}).click();await options.getByRole("button",{name:"Done",exact:true}).click();
  await dialog.getByRole("button",{name:/^Lead project/}).click();await page.getByRole("option",{name:/Backend/}).click();
  await page.screenshot({animations:"disabled",path:join(output,`multi-job-review-${theme}-${width}.png`)});
  await dialog.getByRole("button",{name:"Start",exact:true}).click();
  await expect(dialog.getByRole("alert")).toContainText("Connection interrupted after acceptance");
  await expect(dialog.getByRole("textbox",{name:"Request 1",exact:true})).toBeDisabled();
  await page.screenshot({animations:"disabled",path:join(output,`multi-job-retry-${theme}-${width}.png`)});
  await page.getByRole("button",{name:"Hide fixture project",exact:true,includeHidden:true}).evaluate(button=>(button as HTMLButtonElement).click());
  await expect(dialog).toHaveCount(0);await expect(page.getByRole("textbox",{name:"Give Arif a job",exact:true})).toHaveValue("");
  await expect(page.getByRole("textbox",{name:"Give Arif a job",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Show fixture project",exact:true}).click();
  await expect(dialog.getByRole("textbox",{name:"Request 1",exact:true})).toHaveValue("Coordinate frontend and backend");
  await dialog.getByRole("button",{name:"Check and retry",exact:true}).click();await expect(dialog).toHaveCount(0);
  const created=page.getByRole("button",{name:"Coordinate frontend and backend",exact:true});await expect(created).toHaveCount(1);await created.click();
  await expect(page.getByRole("dialog")).toContainText("Lead project: Backend");
  await expect(page.getByRole("dialog")).toContainText("Backend · MonoCode");
  await page.screenshot({animations:"disabled",path:join(output,`multi-job-detail-${theme}-${width}.png`)});
  await page.getByRole("button",{name:"Hide fixture project",exact:true,includeHidden:true}).evaluate(button=>(button as HTMLButtonElement).click());
  await expect(page.getByRole("dialog")).toHaveCount(0);await expect(created).toHaveCount(0);
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`room live project privacy ${theme} ${width}`,async({page})=>{
  page.setDefaultTimeout(15000);
  page.on("pageerror",error=>console.error("Room fixture error:",error.message));
  const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});
  await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&privacy=1`);
  await page.getByRole("tab",{name:/^Jobs(?: \d+)?$/}).click();
  await page.getByRole("checkbox",{name:"Select Secret project request",exact:true}).check();
  await page.getByRole("button",{name:"Secret project request",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("Secret source request");
  // This fixture-only parent control simulates privacy changing outside the modal.
  await page.getByRole("button",{name:"Hide fixture project",exact:true,includeHidden:true}).evaluate(button=>(button as HTMLButtonElement).click());
  await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page.locator("body")).not.toContainText("Secret");
  await expect(page.getByText("1 selected",{exact:true})).toHaveCount(0);
  await page.screenshot({animations:"disabled",path:join(output,`privacy-jobs-${theme}-${width}.png`)});
  await page.getByRole("tab",{name:"Conversations",exact:true}).click();
  const search=page.getByRole("searchbox",{name:"Search this section",exact:true});await search.fill("Secret");
  await expect(page.getByText("No messages to display",{exact:true})).toBeVisible();await expect(page.locator("body")).not.toContainText("Secret transcript source");
  await expect(page.locator("body")).not.toContainText("Secret linked global source");
  await page.screenshot({animations:"disabled",path:join(output,`privacy-conversations-${theme}-${width}.png`)});
  await search.fill("");await page.getByRole("tab",{name:"History",exact:true}).click();
  await expect(page.locator("body")).not.toContainText("Secret source activity");
  await page.screenshot({animations:"disabled",path:join(output,`privacy-history-${theme}-${width}.png`)});
  await page.getByRole("button",{name:"More options",exact:true}).click();await page.getByRole("menuitem",{name:"Recently deleted",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("An earlier research request");await expect(page.getByRole("dialog")).not.toContainText("Secret deleted request");
  await page.screenshot({animations:"disabled",path:join(output,`privacy-trash-${theme}-${width}.png`)});
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`manual session opt-in ${theme} ${width}`,async({page})=>{
  const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});
  await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&manual=1`);
  await page.getByRole("tab",{name:"Sessions",exact:true}).click();
  const section=page.getByRole("region",{name:"Manual session supervision",exact:true});
  await expect(section.getByText("Execution changed. Enroll again to supervise this source.",{exact:true})).toBeVisible();
  await expect(page.getByText(/Secret (conversation|project)/)).toHaveCount(0);
  await page.screenshot({animations:"disabled",path:join(output,`manual-sessions-${theme}-${width}.png`)});
  await section.getByRole("button",{name:"Enroll conversation",exact:true}).first().click();
  await expect(section.getByRole("button",{name:"Turn off supervision",exact:true})).toBeEnabled();
  await page.screenshot({animations:"disabled",path:join(output,`manual-enrolling-${theme}-${width}.png`)});
  await section.getByRole("button",{name:"Turn off supervision",exact:true}).click();
  await expect(section.getByText("Manual session supervision is off.",{exact:true})).toBeVisible();
  await section.getByRole("button",{name:"Choose projects in Settings",exact:true}).click();
  const dialog=page.getByRole("dialog");const manual=dialog.getByRole("region",{name:"Manual session supervision",exact:true});
  await manual.getByRole("switch",{name:"Allow manual session supervision",exact:true}).scrollIntoViewIfNeeded();
  await expect(manual.getByRole("switch",{name:"Allow manual session supervision",exact:true})).toHaveAttribute("aria-checked","false");
  await expect(manual.getByRole("checkbox",{name:"MonoCode",exact:true})).toBeChecked();
  await expect(dialog.getByText("Secret project",{exact:true})).toHaveCount(0);
  await page.screenshot({animations:"disabled",path:join(output,`manual-settings-${theme}-${width}.png`)});
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`unknown briefing language ${theme} ${width}`,async({page})=>{
  const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});
  await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&briefing=1&language-unknown=1`);
  const card=page.getByRole("region",{name:"While you were away",exact:true});
  await expect(card.getByRole("button",{name:"Listen",exact:true})).toBeDisabled();
  await expect(card.getByText("Speak once or choose a language before listening.",{exact:true})).toBeVisible();
  await page.screenshot({animations:"disabled",path:join(output,`unknown-language-${theme}-${width}.png`)});
  await card.getByRole("button",{name:"Choose language",exact:true}).click();await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button",{name:"Language: Auto",exact:true})).toBeVisible();
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`briefing and retention ${theme} ${width}`,async({page})=>{
  const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});
  await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&briefing=1&presence=unknown`);
  await expect(page.getByText("Current availability: Unknown",{exact:true})).toBeVisible();
  const card=page.getByRole("region",{name:"While you were away",exact:true});
  await card.getByRole("button",{name:"Listen",exact:true}).click();await expect(card.getByText("Reading the briefing. This does not open the microphone.",{exact:true})).toBeVisible();
  await page.screenshot({animations:"disabled",path:join(output,`briefing-playing-${theme}-${width}.png`)});
  await card.getByRole("button",{name:"Stop listening",exact:true}).click();
  await card.getByRole("button",{name:"Go to approvals",exact:true}).click();
  await expect(page.locator("body")).toHaveAttribute("data-opened-goal","assistant-job-two");
  await card.getByRole("button",{name:"Open notes",exact:true}).click();await expect(page.locator("#assistant-content")).toHaveAttribute("aria-label","Notes");
  await page.getByRole("tab",{name:/^Conversations/}).click();
  const draft=page.getByRole("textbox",{name:"Message Arif",exact:true});await draft.fill("Keep this unsent draft");
  await page.getByRole("button",{name:"Conversation actions",exact:true}).click();await page.getByRole("menuitem",{name:"Clear conversation...",exact:true}).click();
  const confirm=page.getByRole("dialog",{name:"Clear this conversation?",exact:true});await expect(confirm).toBeVisible();
  await page.screenshot({animations:"disabled",path:join(output,`clear-conversation-${theme}-${width}.png`)});
  await confirm.getByRole("button",{name:"Clear all messages",exact:true}).click();await expect(draft).toHaveValue("Keep this unsent draft");
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  const retention=page.getByRole("button",{name:"Keep conversation messages: Forever",exact:true});await retention.scrollIntoViewIfNeeded();await retention.click();await page.getByRole("option",{name:"30 days",exact:true}).click();
  await expect(page.getByRole("button",{name:"Keep conversation messages: 30 days",exact:true})).toBeVisible();
  await page.screenshot({animations:"disabled",path:join(output,`retention-${theme}-${width}.png`)});
  await page.getByRole("button",{name:"Save",exact:true}).click();await expect(page.getByRole("dialog")).not.toBeVisible();
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
  test(`chief review recovery ${theme} ${width}`,async({page})=>{
    const output=join(process.cwd(),"temp/verification/arif-assistant-room");
    await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});
    await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&chief-blocked=1`);
    await expect(page.getByText("Supervisor review needs attention",{exact:true})).toBeVisible();
    await page.screenshot({animations:"disabled",path:join(output,`chief-recovery-${theme}-${width}.png`)});
    await page.getByRole("button",{name:"Retry review",exact:true}).click();
    await expect(page.getByText("Supervisor review needs attention",{exact:true})).not.toBeVisible();
    await expect(page.getByRole("button",{name:"Stop everything",exact:true})).toBeVisible();
  });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`emergency shortcut settings ${theme} ${width}`,async({page})=>{
  const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});
  await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&keybindings=1`);
  const change=page.getByRole("button",{name:"Change App: Stop computer use shortcut",exact:true});
  await change.scrollIntoViewIfNeeded();await expect(change).toContainText(/Esc/);
  await change.click();await page.keyboard.press("Escape");await expect(change).toContainText(/Esc/);
  await page.screenshot({animations:"disabled",path:join(output,`emergency-shortcut-${theme}-${width}.png`)});
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`managed session filter ${theme} ${width}`,async({page})=>{
  const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});
  await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&session-filter=1`);
  await expect(page.getByText("Owner's manual conversation",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Filter sessions",exact:true}).click();
  const filter=page.getByRole("menuitemcheckbox",{name:"Managed by Arif",exact:true});
  await expect(filter).toHaveAttribute("aria-checked","false");await filter.click();
  await expect(filter).toHaveAttribute("aria-checked","true");
  await expect(page.getByText("Owner's manual conversation",{exact:true})).toHaveCount(0);
  await expect(page.getByText("Verify retained job output",{exact:true})).toBeVisible();
  await page.screenshot({animations:"disabled",path:join(output,`managed-filter-${theme}-${width}.png`)});
  await page.keyboard.press("Escape");await expect(page.getByRole("menu",{name:"Filter sessions",exact:true})).not.toBeVisible();
 });
for(const theme of ["light","dark"])for(const width of [1280,800])
  test(`Chief retained context explanation ${theme} ${width}`,async({page})=>{
    const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});
    await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}`);
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    const explanation=page.getByText("These limits estimate retained text. Summaries, daily renewal, review reservations and a 1 MB safety limit can shorten it earlier. They do not guarantee the provider's context window or charges.",{exact:true});
    await explanation.scrollIntoViewIfNeeded();await expect(explanation).toBeVisible();
    await page.screenshot({animations:"disabled",path:join(output,`${theme}-${width}-chief-context.png`)});
  });

for(const theme of ["light","dark"])for(const width of [1280,800])
  test(`desktop emergency strip ${theme} ${width}`,async({page})=>{
    const output=join(process.cwd(),"temp/verification/arif-assistant-room");
    await mkdir(output,{recursive:true});
    await page.setViewportSize({width,height:900});
    await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&desktop=1`);
    const strip=page.getByRole("complementary",{name:"Computer controls",exact:true});
    await expect(strip).toBeVisible();
    await expect(strip.getByRole("button",{name:"Stop computer use",exact:true})).toBeEnabled();
    await expect(strip).toContainText("Notepad · Set value");
    await page.screenshot({animations:"disabled",path:join(output,`desktop-strip-${theme}-${width}.png`)});
    await strip.getByRole("button",{name:"Stop computer use",exact:true}).click();
    await expect(strip).not.toBeVisible();
  });

test("searches all conversations and saved memory through the Host adapter", async ({
  page,
}) => {
  await page.goto("/tests/browser/assistant-room.html?theme=light");
  await page.getByRole("tab", { name: "Conversations", exact: true }).click();
  await expect(
    page.getByText("Keep an eye on recovery and prepare the release notes.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search this section", exact: true })
    .fill("Nightly");
  await expect(
    page.getByText("Nightly follow-up across projects", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Memory", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "Search this section", exact: true })
    .fill("concise");
  await expect(
    page.getByText("Prefer concise updates with source evidence.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Let me finish speaking before you reply.", { exact: true }),
  ).toHaveCount(0);
});

test("uses the chosen name and Turkish suffix in the rendered room", async ({
  page,
}) => {
  const output = join(process.cwd(), "temp/verification/arif-assistant-room");
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 800, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(
    "/tests/browser/assistant-room.html?theme=light&lang=tr&name=Ay%C5%9Fe",
  );
  await expect(
    page.getByRole("heading", { name: "Asistan Ayşe", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Ayşe'nin odası", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Çalışıyor · 2 iş", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: join(output, "tr-light-800-ayse.png"),
  });
});

// Synthetic Host adapter; verifies composition and owner controls only.
// No provider execution, real job, microphone or desktop authority is exercised.
for (const theme of ["light", "dark"] as const)
  for (const width of [1280, 800]) {
    test(`assistant Room ${theme} ${width}`, async ({ page }) => {
      const output = join(
        process.cwd(),
        "temp/verification/arif-assistant-room",
      );
      await mkdir(output, { recursive: true });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant-room.html?theme=${theme}`);
      const room = page.getByRole("main");
      await expect(
        room.getByRole("heading", { name: "Assistant Arif", exact: true }),
      ).toBeVisible();
      for (const tab of [
        "Today",
        "Conversations",
        "Jobs",
        "Sessions",
        "Notes",
        "History",
        "Memory",
      ]) {
        await page
          .getByRole("tab", { name: new RegExp(`^${tab}(?:\\s|$)`) })
          .click();
        await expect(page.locator("#assistant-content")).toHaveAttribute(
          "aria-label",
          tab,
        );
        if (tab === "Sessions") {
          await expect(
            page.getByText("Context ready", { exact: true }),
          ).toBeVisible();
          await expect(
            page.getByText("Compaction required before the next message", {
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            page.getByText("Handoff required before the next message", {
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            page.getByText("Context usage unavailable", { exact: true }),
          ).toHaveCount(0);
        }
        expect(
          await room.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          animations: "disabled",
          path: join(output, `${theme}-${width}-${tab.toLowerCase()}.png`),
        });
      }
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${theme}-${width}-settings.png`),
      });
      await page
        .getByText("Sleep prevention is off", { exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByText("Sleep prevention is off", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${theme}-${width}-keep-awake.png`),
      });
      await page
        .getByRole("button", { name: "Stop computer use", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByText("Not installed", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${theme}-${width}-computer-settings.png`),
      });
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await page
        .getByRole("button", { name: "More options", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Recently deleted", exact: true })
        .click();
      await expect(
        page.getByText("An earlier research request", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${theme}-${width}-recently-deleted.png`),
      });
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await page.getByRole("tab", { name: /^Jobs(?:\s|$)/ }).click();
      await page
        .getByRole("button", { name: "Improve session recovery", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${theme}-${width}-job-details.png`),
      });
    });
  }

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`note exact recovery ${theme} ${width}`,async({page})=>{
  const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});
  await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&note-retry=1`);
  await page.getByRole("tab",{name:"Notes",exact:true}).click();await page.getByRole("button",{name:"New note",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"New note",exact:true});await dialog.getByRole("textbox",{name:"Title",exact:true}).fill("Owner's retained note");await dialog.getByRole("textbox",{name:"Note",exact:true}).fill("Keep this exact body when the native save reply is lost.");
  await dialog.getByRole("button",{name:"Save",exact:true}).click();await expect(dialog.getByRole("alert")).toContainText("after note commit");await expect(dialog.getByRole("textbox",{name:"Note",exact:true})).toBeDisabled();
  const first=await page.evaluate(()=>JSON.parse(localStorage.getItem("bycoda.assistant.note-draft:new:record")!));expect(first.expectedUpdatedAt).toBe(0);expect(first.id).toBeTruthy();
  await page.screenshot({animations:"disabled",path:join(output,`note-unknown-${theme}-${width}.png`)});
  await dialog.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"New note",exact:true}).click();await expect(dialog.getByRole("textbox",{name:"Note",exact:true})).toHaveValue(first.body);
  await page.screenshot({animations:"disabled",path:join(output,`note-reopened-${theme}-${width}.png`)});await dialog.getByRole("button",{name:"Save",exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Owner's retained note",exact:true})).toHaveCount(1);expect(await page.evaluate(()=>localStorage.getItem("bycoda.assistant.note-draft:new:record"))).toBeNull();
  await page.screenshot({animations:"disabled",path:join(output,`note-recovered-${theme}-${width}.png`)});
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`independent assistant role models ${theme} ${width}`,async({page})=>{
  const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});
  await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}`);
  await page.getByRole("button",{name:"Settings",exact:true}).click();const dialog=page.getByRole("dialog");
  const autonomy=dialog.locator("section").filter({has:page.getByRole("heading",{name:"Autonomy",exact:true})});
  await autonomy.getByRole("button",{name:"Fixture model",exact:true}).click();
  await expect(autonomy.getByText("Supervisor model",{exact:true})).toHaveCount(0);
  await autonomy.screenshot({animations:"disabled",path:join(output,`roles-compact-${theme}-${width}.png`)});
  await autonomy.getByRole("button",{name:"Advanced role models",exact:true}).click();
  for(const label of ["Supervisor model","Conversation model","Planning model"]){
    const field=autonomy.locator("fieldset").filter({has:page.getByText(label,{exact:true})});
    await field.getByRole("button",{name:"Use worker model",exact:true}).click();
  }
  await autonomy.screenshot({animations:"disabled",path:join(output,`roles-advanced-${theme}-${width}.png`)});
  await dialog.getByRole("button",{name:"Save",exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole("button",{name:"Settings",exact:true}).click();await dialog.getByRole("button",{name:"Advanced role models",exact:true}).click();
  const planning=dialog.locator("fieldset").filter({has:page.getByText("Planning model",{exact:true})});
  await expect(planning.getByRole("button",{name:"fixture-role-model",exact:true})).toBeVisible();await planning.getByRole("button",{name:"Use worker model",exact:true}).click();
  await dialog.getByRole("button",{name:"Save",exact:true}).click();await page.getByRole("button",{name:"Settings",exact:true}).click();await dialog.getByRole("button",{name:"Advanced role models",exact:true}).click();
  await expect(dialog.locator("fieldset").filter({has:page.getByText("Planning model",{exact:true})}).getByRole("button",{name:"Use worker model",exact:true})).toBeVisible();
  await expect(dialog.locator("fieldset").filter({has:page.getByText("Supervisor model",{exact:true})}).getByRole("button",{name:"fixture-role-model",exact:true})).toBeVisible();
 });

for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`quick Room note ${theme} ${width}`,async({page})=>{
  page.setDefaultTimeout(15000);const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&multi=1&quick=1`);
  const request='Save a note saying "stop everything"';await page.getByRole("textbox",{name:"Give Arif a job",exact:true}).fill(request);await page.getByRole("button",{name:"Review jobs",exact:true}).click();const dialog=page.getByRole("dialog",{name:"Review jobs",exact:true});
  await dialog.getByRole("button",{name:/^Participating projects/}).click();const projects=page.getByRole("dialog",{name:"Participating projects options",exact:true});await projects.getByRole("option",{name:/Backend/}).click();await projects.getByRole("button",{name:"Done",exact:true}).click();
  await dialog.getByRole("button",{name:/^Job type/}).click();await page.getByRole("option",{name:"Save personal note",exact:true}).click();await expect(dialog.getByRole("button",{name:/^Participating projects/})).toHaveCount(0);
  await dialog.getByRole("textbox",{name:"Note title",exact:true}).fill("Quoted commands are data");await dialog.getByRole("textbox",{name:"Note content",exact:true}).fill('The exact note says: stop everything.\nHepsini durdur diye bir not yaz.');
  await dialog.getByRole("button",{name:/^Job type/}).click();await page.getByRole("option",{name:"Project work",exact:true}).click();await expect(dialog.getByRole("button",{name:/^Participating projects/})).toContainText("2 selected");await dialog.getByRole("button",{name:/^Participating projects/}).click();await expect(page.getByRole("dialog",{name:"Participating projects options",exact:true}).getByRole("option",{name:/Backend/})).toHaveAttribute("aria-selected","true");await page.getByRole("dialog",{name:"Participating projects options",exact:true}).getByRole("button",{name:"Done",exact:true}).click();await dialog.getByRole("button",{name:/^Job type/}).click();await page.getByRole("option",{name:"Save personal note",exact:true}).click();await expect(dialog.getByRole("textbox",{name:"Note title",exact:true})).toHaveValue("Quoted commands are data");
  await dialog.getByRole("textbox",{name:"Note title",exact:true}).fill("");await expect(dialog).toBeVisible();await expect(dialog.getByRole("button",{name:"Save notes",exact:true})).toBeDisabled();await dialog.getByRole("textbox",{name:"Note title",exact:true}).fill("Quoted commands are data");
  await page.screenshot({animations:"disabled",path:join(output,`quick-review-${theme}-${width}.png`)});await dialog.getByRole("button",{name:"Save notes",exact:true}).click();await expect(dialog.getByRole("alert")).toContainText("Quick receipt lost");await expect(dialog.getByRole("textbox",{name:"Note content",exact:true})).toBeDisabled();await page.screenshot({animations:"disabled",path:join(output,`quick-unknown-${theme}-${width}.png`)});
  await dialog.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"Review jobs",exact:true}).click();await expect(dialog.getByRole("textbox",{name:"Note content",exact:true})).toBeDisabled();await dialog.getByRole("button",{name:"Check and retry",exact:true}).click();await expect(dialog).toHaveCount(0);expect(await page.locator("body").getAttribute("data-quick-creates")).toBe("1");
  await page.getByRole("tab",{name:/^Jobs(?: \d+)?$/}).click();await page.getByRole("button",{name:request,exact:true}).click();const details=page.getByRole("dialog",{name:request,exact:true});await expect(details).toContainText("Note saved");await expect(details).not.toContainText("Lead project");await page.screenshot({animations:"disabled",path:join(output,`quick-details-${theme}-${width}.png`)});await details.getByRole("button",{name:"Open saved note",exact:true}).click();await expect(page.getByRole("dialog",{name:"Edit note",exact:true}).getByRole("textbox",{name:"Title",exact:true})).toHaveValue("Quoted commands are data");
  await page.screenshot({animations:"disabled",path:join(output,`quick-open-note-${theme}-${width}.png`)});
 });
for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`quick Voice review ${theme} ${width}`,async({page})=>{
  page.setDefaultTimeout(15000);const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&voice-jobs=1`);
  await page.getByRole("button",{name:/^Job type/}).click();await page.getByRole("option",{name:"Save personal note",exact:true}).click();await page.getByRole("textbox",{name:"Note title",exact:true}).fill("Personal notebook");await page.getByRole("textbox",{name:"Note content",exact:true}).fill('A note containing "stop everything" stays note content.');
  await page.screenshot({animations:"disabled",path:join(output,`quick-voice-review-${theme}-${width}.png`)});await page.getByRole("button",{name:"Save notes",exact:true}).click();await expect(page.getByRole("textbox",{name:"Note content",exact:true})).toBeDisabled();await page.screenshot({animations:"disabled",path:join(output,`quick-voice-pending-${theme}-${width}.png`)});
 });
for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`note exact trash receipt ${theme} ${width}`,async({page})=>{
  const output=join(process.cwd(),"temp/verification/arif-assistant-room");await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&note-trash=1`);
  await page.getByRole("tab",{name:"Notes",exact:true}).click();await page.getByRole("button",{name:"Delete note",exact:true}).click();await page.getByRole("dialog",{name:"Delete note?",exact:true}).getByRole("button",{name:"Delete",exact:true}).click();await page.getByRole("button",{name:"Undo",exact:true}).click();await expect(page.locator("body")).toContainText("Temporary exact restore failure");expect(await page.locator("body").getAttribute("data-last-restore")).toBe("notetrash:backup-note-one");await page.screenshot({animations:"disabled",path:join(output,`note-trash-failure-${theme}-${width}.png`)});
  await page.getByRole("button",{name:"More options",exact:true}).click();await page.getByRole("menuitem",{name:"Recently deleted",exact:true}).click();const library=page.getByRole("dialog",{name:"Recently deleted",exact:true});await library.getByText("Today's progress",{exact:true}).locator("..").locator("..").getByRole("button",{name:"Restore",exact:true}).click();await expect(page.locator("body")).not.toContainText("Temporary exact restore failure");await expect(page.getByRole("button",{name:"Undo",exact:true})).toHaveCount(0);await library.getByRole("button",{name:"Close",exact:true}).click();await expect(page.getByRole("button",{name:"Today's progress",exact:true})).toBeVisible();await page.screenshot({animations:"disabled",path:join(output,`note-trash-restored-${theme}-${width}.png`)});
 });
for(const theme of ["light","dark"])for(const width of [1280,800])
 test(`room completion controls ${theme} ${width}`,async({page})=>{
  const output="temp/verification/arif-assistant/room-completion-fixture";await mkdir(output,{recursive:true});await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:"reduce"});await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&completion=1`);
  await page.getByRole("tab",{name:/^Jobs\b/}).click();await page.getByRole("button",{name:"Job actions",exact:true}).click();await page.getByRole("menuitem",{name:"Priority",exact:true}).click();await page.getByRole("button",{name:"Priority: Normal",exact:true}).click();await page.getByRole("option",{name:"High",exact:true}).click();await page.screenshot({animations:"disabled",path:join(output,`priority-${theme}-${width}.png`)});await page.getByRole("button",{name:"Save",exact:true}).click();
  await page.getByRole("button",{name:"Job actions",exact:true}).click();await page.getByRole("menuitem",{name:"Replan",exact:true}).click();const replan=page.getByRole("dialog");await replan.getByRole("textbox",{name:"Replan feedback",exact:true}).fill("Keep the verified recovery path. Replan only the remaining checks.");await page.screenshot({animations:"disabled",path:join(output,`replan-draft-${theme}-${width}.png`)});await replan.getByRole("button",{name:"Replan",exact:true}).click();await expect(replan.getByRole("button",{name:"Check status",exact:true})).toBeVisible();await page.screenshot({animations:"disabled",path:join(output,`replan-unknown-${theme}-${width}.png`)});await replan.getByRole("button",{name:"Close",exact:true}).last().click();
  await page.getByRole("button",{name:"Filter",exact:true}).click();const filter=page.getByRole("dialog",{name:"Filter",exact:true});await filter.getByRole("button",{name:"Created: All dates",exact:true}).click();await page.getByRole("option",{name:"Today",exact:true}).click();await page.screenshot({animations:"disabled",path:join(output,`job-filters-${theme}-${width}.png`)});await page.keyboard.press("Escape");
  await page.getByRole("tab",{name:"Notes",exact:true}).click();await page.getByRole("button",{name:"Summarize today",exact:true}).click();await expect(page.getByText(/Today's saved fixture summary:/)).toBeVisible();await page.screenshot({animations:"disabled",path:join(output,`daily-summary-${theme}-${width}.png`)});
  await page.getByRole("button",{name:"Settings",exact:true}).click();await page.getByRole("group",{name:"Worker cache usage",exact:true}).screenshot({animations:"disabled",path:join(output,`worker-cache-${theme}-${width}.png`)});
  await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&session-controls=pending`);const control=page.getByRole("button",{name:"Take assistant off this session",exact:true});await control.focus();await page.screenshot({animations:"disabled",path:join(output,`session-controls-ready-${theme}-${width}.png`)});await page.keyboard.press("Enter");const detach=page.getByRole("dialog");await detach.getByRole("button",{name:"Remove supervision",exact:true}).focus();await page.keyboard.press("Enter");await expect(detach.getByRole("button",{name:/Remove supervision/})).toBeDisabled();await page.screenshot({animations:"disabled",path:join(output,`session-detach-pending-${theme}-${width}.png`)});await page.evaluate(()=>(window as any).__finishFixtureDetach());await expect(detach.getByText("Assistant supervision removed",{exact:true})).toBeVisible();await page.screenshot({animations:"disabled",path:join(output,`session-detach-removed-${theme}-${width}.png`)});
  await page.goto(`/tests/browser/assistant-room.html?theme=${theme}&session-controls=unknown`);await page.getByRole("button",{name:"Take assistant off this session",exact:true}).click();await page.getByRole("button",{name:"Remove supervision",exact:true}).click();await expect(page.getByText("Supervision removal is unconfirmed. Check its status before continuing.",{exact:true})).toBeVisible();await page.screenshot({animations:"disabled",path:join(output,`session-detach-unknown-${theme}-${width}.png`)});expect(await page.evaluate(()=>(window as any).__fixtureDetachCalls)).toBe(1);await page.getByRole("button",{name:"Check status",exact:true}).click();await expect(page.getByText("Assistant supervision removed",{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).__fixtureDetachCalls)).toBe(1);
 });
