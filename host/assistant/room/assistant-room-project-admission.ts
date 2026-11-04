import { createPublicKey, verify } from "node:crypto";
/** Delegated target projects need an owner-reviewed grant AND a live target privacy permit.
 * This authority is separate from ordinary manually opened sessions and task ownership. */
export type DelegatedProjectPolicy = Readonly<{ targetEnvironmentId:string; projectId:string; actions:readonly string[]; allowHeadless:boolean; revision:string; expiresAt?:number }>;
export type DelegatedProjectPermit = Readonly<{ targetEnvironmentId:string; projectId:string; policyRevision:string; current:()=>boolean }>;
/** Signature is useful only with a key independently selected from owner-controlled native trust. */
export function verifyDelegatedProjectPolicy(policy:DelegatedProjectPolicy, signature:string, trustedPublicKey:string, now=Date.now()): boolean {
  try {
    if (!policy.targetEnvironmentId || !policy.projectId || !/^[a-f0-9]{64}$/.test(policy.revision) || !Array.isArray(policy.actions) || !policy.actions.length || policy.actions.length>6 || new Set(policy.actions).size!==policy.actions.length || policy.actions.some(action=>!["sessions.list","sessions.read","tasks.list","tasks.get","tasks.create","tasks.update"].includes(action)) || typeof policy.allowHeadless!=="boolean" || !Number.isSafeInteger(policy.expiresAt) || policy.expiresAt!<=now || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
    const key=createPublicKey(trustedPublicKey);
    if (key.asymmetricKeyType!=="ed25519") return false;
    const bytes=Buffer.from(JSON.stringify(["bycoda-delegated-project-policy-v1",policy.targetEnvironmentId,policy.projectId,policy.actions,policy.allowHeadless,policy.revision,policy.expiresAt]));
    return verify(null,bytes,key,Buffer.from(signature,"base64url"));
  } catch { return false; }
}
export function assertDelegatedProjectAdmission(input:{ targetEnvironmentId:string; projectId:string; action:string; headless:boolean | "unknown"; policy?:DelegatedProjectPolicy; policySignature?:string; trustedPublicKey?:string; permit?:DelegatedProjectPermit }) {
  const { policy, permit }=input;
  if (!policy || !permit || !input.policySignature || !input.trustedPublicKey || !verifyDelegatedProjectPolicy(policy,input.policySignature,input.trustedPublicKey)) throw new Error("Target Host project visibility and owner-reviewed delegation policy are unavailable.");
  if (input.headless === "unknown" || policy.targetEnvironmentId!==input.targetEnvironmentId || permit.targetEnvironmentId!==input.targetEnvironmentId || policy.projectId!==input.projectId || permit.projectId!==input.projectId || policy.revision!==permit.policyRevision || (policy.expiresAt !== undefined && policy.expiresAt <= Date.now()) || !policy.actions.includes(input.action) || (input.headless && !policy.allowHeadless) || !permit.current()) throw new Error("Target Host project delegation is not admitted.");
  return permit;
}
