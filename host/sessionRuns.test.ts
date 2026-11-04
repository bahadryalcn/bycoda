import {expect,it} from "vitest";
import type {HostStore} from "./store";
import {sessionRunState} from "./sessionRuns";
import {isSessionRunActivity} from "./session-run-activity";

it("never treats polls, metadata writes or another run's activity as observed output",async()=>{
  const record={status:"running",runId:"current",updatedAt:999_999,session:{blocks:[]},runActivity:undefined as {runId:string;lastActivityAt:number}|undefined};
  const store={session:async()=>record} as unknown as HostStore;
  const run={sessionId:"s",runId:"current",startedAt:100};
  for(const activity of [undefined,{runId:"old",lastActivityAt:200},{runId:"current",lastActivityAt:99},{runId:"current",lastActivityAt:1001},{runId:"current",lastActivityAt:NaN}]){
    record.runActivity=activity;
    expect(await sessionRunState(store,run,0,1000)).toEqual({state:"running",needsInput:false});
  }
  record.runActivity={runId:"current",lastActivityAt:200};
  expect(await sessionRunState(store,run,0,1000)).toMatchObject({lastActivityAt:200});
});
it("counts actual repeated output but excludes telemetry and periodic background snapshots",()=>{
  expect(isSessionRunActivity({type:"tool.updated",callId:"shell",detail:"still working"},false)).toBe(true);
  expect(isSessionRunActivity({type:"message.delta",text:"same"},false)).toBe(true);
  expect(isSessionRunActivity({type:"message.delta",text:""},false)).toBe(false);
  expect(isSessionRunActivity({type:"context",used:1000},true)).toBe(false);
  expect(isSessionRunActivity({type:"background.updated",tasks:["shell"]},true)).toBe(false);
  expect(isSessionRunActivity({type:"status",text:"working"},true)).toBe(false);
  expect(isSessionRunActivity({type:"tool.updated",callId:"shell",status:"running"},false)).toBe(false);
});
it("does not fire the run time limit across a one hour host sleep", async()=>{
  const record={status:"running",runId:"sleepy",updatedAt:0,session:{blocks:[]},runActivity:undefined};
  const store={session:async()=>record} as unknown as HostStore;
  const run={sessionId:"s",runId:"sleepy",startedAt:0};
  const minute=60_000,limit=30;
  expect(await sessionRunState(store,run,limit,0)).toMatchObject({state:"running"});
  expect(await sessionRunState(store,run,limit,10*minute)).toMatchObject({state:"running"});
  // The laptop sleeps for an hour; the wall clock is now 70 minutes past the start.
  expect(await sessionRunState(store,run,limit,70*minute)).toMatchObject({state:"running"});
  // Awake and ticking: active time reaches the limit only after real activity.
  let now=70*minute,state=await sessionRunState(store,run,limit,now);
  while(state.state==="running"&&now<200*minute){now+=30_000;state=await sessionRunState(store,run,limit,now);}
  expect(state).toMatchObject({state:"overLimit"});
  expect(now).toBeGreaterThan(90*minute);
});
it("keeps counting wall-clock time for a run without a run id",async()=>{
  const record={status:"running",runId:undefined,updatedAt:0,session:{blocks:[]},runActivity:undefined};
  const store={session:async()=>record} as unknown as HostStore;
  expect(await sessionRunState(store,{sessionId:"s",startedAt:0},30,31*60_000)).toMatchObject({state:"overLimit"});
});
