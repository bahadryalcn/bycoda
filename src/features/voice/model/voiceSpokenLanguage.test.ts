// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from "vitest";
import {acceptedVoiceLanguage,VoiceSpokenLanguageWrites} from "./voiceSpokenLanguage";
import type {AssistantRequest} from "../../../shared/model/host-contracts/assistant";
afterEach(()=>localStorage.clear());
it("prefers real ASR metadata and never uses interface locale or assistant text",()=>{
  expect(acceptedVoiceLanguage("hello","tr")).toBe("tr-TR");expect(acceptedVoiceLanguage("Merhaba","English")).toBe("en-US");
  expect(acceptedVoiceLanguage("","auto")).toBeUndefined();
  for(const ambiguous of ["okay","yes","Arif","por favor","Monocode","42"])expect(acceptedVoiceLanguage(ambiguous)).toBeUndefined();
});
it.each([["Sözümü kesme lütfen","tr-TR"],["Hello","en-US"],["Guten Morgen bitte","de-DE"],["Bonjour merci","fr-FR"],["Hola gracias","es-ES"],["Olá obrigado","pt-PT"],["これは今日の仕事です","ja-JP"],["请你看看今天的工作","zh-CN"]])("uses only high confidence accepted owner text: %s",(text,language)=>expect(acceptedVoiceLanguage(text)).toBe(language));
it("keeps the original language/id/accepted timestamp when a metadata save is retried after reload",async()=>{
  const request=vi.fn(async(_input:AssistantRequest)=>({ok:true}));request.mockRejectedValueOnce(new Error("Lost acknowledgement"));
  const first=new VoiceSpokenLanguageWrites(request);await expect(first.record("Sözümü kesme","tr",1234)).rejects.toThrow();
  const payload=request.mock.calls[0][0];expect(payload).toMatchObject({op:"voice.language.record",language:"tr-TR",observedAt:1234});expect(JSON.stringify(payload)).not.toContain("Sözümü");
  await new VoiceSpokenLanguageWrites(request).retry();expect(request.mock.calls[1][0]).toEqual(payload);
});
