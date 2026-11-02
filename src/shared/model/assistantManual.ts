/** Backend-owned manual supervision identity. These display records are not grants
 * to create tasks or to alter a canonical planner/reviewer/automation run. */
export type ManualSessionSource={projectId:string;executionCwd:string;authorityGeneration?:number;harness:string;model:string;modelSettings:Record<string,string>;runtimeMode:string;providerAccountId?:string};
export type ManualSessionCandidate={sessionId:string;projectId:string;title:string;sourceToken:string;eligible:boolean;reason?:string;enrolledSourceChanged?:boolean};
export type ManualSupervisionGrant={id:string;sessionId:string;title?:string;version:number;active:boolean;source:ManualSessionSource;sourceToken:string;enrolledAt:number;updatedAt:number;revokedAt?:number};
export type ManualSupervisionPolicy={enabled:boolean;version:number;projectIds:string[]};
