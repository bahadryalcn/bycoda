import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { NativeAdmissionOwner, nativeAdmissionBytes, nativeAdmissionDigest, nativeAdmissionFingerprint } from "../native/assistant-native-admission";
import { RoomAttestationSigner, verifyRoomAttestation, type RoomAttestation } from "./assistant-room-attestation";
import { createRoomNativeSourceAdapter } from "./assistant-room-native-adapter";

it("signs only native-approved exact bytes for a real Room and retires revoked installation", async () => {
 const dir=mkdtempSync(join(tmpdir(),"room-native-adapter-")), registry=join(dir,"registry.json");
 try {
  const native=generateKeyPairSync("ed25519"), host="origin", installationId="native-fixture";
  const entry={installationId,hostId:host,publicKey:native.publicKey.export({type:"spki",format:"pem"}).toString(),fingerprint:nativeAdmissionFingerprint(native.publicKey)};
  writeFileSync(registry, JSON.stringify({version:1,generation:"a".repeat(64),entries:[entry]}));
  const admission=new NativeAdmissionOwner(registry,host,false,()=>1000);
  const signer=new RoomAttestationSigner(join(dir,"room-key"),host,async id=>id==="room"?{id}:null,()=>1000);
  const adapter=createRoomNativeSourceAdapter({environmentId:host,admission,signer,thread:async id=>id==="room"?{id}:null});
  const call=async(action:"origin"|"attest", operation:unknown) => {
   const operationJson=JSON.stringify(operation), request={installationId,hostId:host,action:`assistant.delegation.${action}`,requestDigest:nativeAdmissionDigest(operationJson)};
   const challenge=await adapter("nativeChallenge",request,async()=>true) as Awaited<ReturnType<typeof admission.challenge>>;
   const proof={challenge,signature:sign(null,nativeAdmissionBytes(challenge),native.privateKey).toString("base64url")};
   return adapter(action,{operationJson,proof},async()=>true);
  };
  const key=await signer.publicKey();
  const origin=await call("origin",{threadId:"room",targetEnvironmentId:"target",projectId:"project",publicKey:key}) as {originNativeRevision:string};
  expect(origin).toMatchObject({environmentId:host,threadId:"room",publicKey:key});
  await expect(call("origin",{threadId:"fake",targetEnvironmentId:"target",projectId:"project",publicKey:key})).rejects.toThrow("source unavailable");
  const value:RoomAttestation={version:1,originEnvironmentId:host,originNativeRevision:origin.originNativeRevision,targetEnvironmentId:"target",threadId:"room",projectId:"project",grantId:"grant",action:"tasks.get",requestId:"request",scopeHash:"a".repeat(64),nonce:"b".repeat(64),expiresAt:2000};
  const result=await call("attest",value) as {signature:string};
  expect(verifyRoomAttestation(key,value,result.signature,1000)).toBe(true);
  writeFileSync(registry, JSON.stringify({version:1,generation:"b".repeat(64),entries:[entry]}));
  await expect(call("attest",value)).rejects.toThrow("admission changed");
  writeFileSync(registry, JSON.stringify({version:1,generation:"c".repeat(64),entries:[]}));
  await expect(call("attest",value)).rejects.toThrow();
 } finally {rmSync(dir,{recursive:true,force:true});}
});
