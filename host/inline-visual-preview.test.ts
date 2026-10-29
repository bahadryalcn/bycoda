import { expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { previewInlineVisual } from "./inline-visual-preview";

it("returns a real screenshot while keeping script interaction inside an opaque offline sandbox", async () => {
  const html = `<h1 id="title">Loading</h1><script>(async()=>{let parentAccess='denied';try{void parent.document.body;parentAccess='EXPOSED'}catch{}let network='denied';try{await fetch('https://example.invalid/probe');network='EXPOSED'}catch{}document.querySelector('#title').textContent=JSON.stringify({script:'ran',parent:parentAccess,network,native:typeof window.__TAURI_INTERNALS__})})();</script><iframe src="https://example.invalid/frame"></iframe>`;
  const result = await previewInlineVisual({version:1,title:"Sandbox preview",html,height:360},()=>true,()=>import("@playwright/test"));
  expect(result.text).toContain('"script":"ran"');
  expect(result.text).toContain('"parent":"denied"');
  expect(result.text).toContain('"network":"denied"');
  expect(result.text).toContain('"native":"undefined"');
  const image = Buffer.from(result.frame.data,"base64");
  expect(image.subarray(0,2)).toEqual(Buffer.from([0xff,0xd8]));
  expect(image.length).toBeGreaterThan(1000);
  const out = resolve("temp/verification/2026-10-29-redesign-remainder/inline");
  mkdirSync(out,{recursive:true});
  writeFileSync(join(out,"agent-preview.jpg"),image);
  writeFileSync(join(out,"agent-preview.json"),JSON.stringify({evidence:"real dev Chromium injected loader; optional installed Host browser runtime unverified",text:result.text,width:result.width,height:result.height},null,2));
},30000);

it("rechecks revocation before launch and after rendering without publishing an image", async () => {
  let checks=0;
  await expect(previewInlineVisual({version:1,title:"Denied",html:"<h1>Test</h1>",height:160},()=>++checks===1,()=>import("@playwright/test"))).rejects.toThrow("revoked");
});

it("reports unavailable optional runtime without installing or broadening permissions", async () => {
  await expect(previewInlineVisual({version:1,title:"Missing",html:"test",height:160},()=>true,async()=>{throw Error("Runtime not configured");})).rejects.toThrow("Runtime not configured");
});
