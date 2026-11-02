// @vitest-environment happy-dom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AssistantPresenceStatus} from './AssistantPresenceStatus';
let container:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.setSystemTime(10000);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('does not briefly report new current Host observations as future timestamps between clock ticks',async()=>{
 const presence={state:'present' as const,since:1,updatedAt:1};
 await act(()=>root.render(createElement(AssistantPresenceStatus,{snapshot:{presence,automaticPresence:{state:'present',supported:true,since:1,updatedAt:10000},effectivePresence:'present'},details:true})));
 expect(container.textContent).toContain('Current availability: Here');
 vi.setSystemTime(20000);
 await act(()=>root.render(createElement(AssistantPresenceStatus,{snapshot:{presence,automaticPresence:{state:'present',supported:true,since:1,updatedAt:20000},effectivePresence:'present'},details:true})));
 expect(container.textContent).toContain('Computer presence: Here');
 await act(()=>vi.advanceTimersByTime(105000));expect(container.textContent).toContain('Current availability: Unknown');
});
it('keeps the manual DND choice visible while reporting unavailable automatic evidence separately',async()=>{
 await act(()=>root.render(createElement(AssistantPresenceStatus,{snapshot:{presence:{state:'dnd',since:1,updatedAt:1},automaticPresence:{state:'unknown',supported:false,since:1,updatedAt:10000},effectivePresence:'dnd'},details:true})));
 expect(container.textContent).toContain('Current availability: Do not disturb');expect(container.textContent).toContain('Computer presence: Unknown');
});
it('keeps compact Here unknown when current computer evidence is unsupported',async()=>{
 await act(()=>root.render(createElement(AssistantPresenceStatus,{compact:true,snapshot:{presence:{state:'present',since:1,updatedAt:1},automaticPresence:{state:'unknown',supported:false,since:1,updatedAt:10000},effectivePresence:'present'}})));
 expect(container.querySelector('[data-presence-state]')?.getAttribute('data-presence-state')).toBe('unknown');
 expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Current availability: Unknown');
 expect(container.querySelector('div')).toBeNull();
});
it('withholds a cached green state while the current read or change is unconfirmed',async()=>{
 const snapshot={presence:{state:'present' as const,since:1,updatedAt:1},automaticPresence:{state:'present' as const,supported:true,since:1,updatedAt:10000},effectivePresence:'present' as const};
 const render=async(unconfirmed:boolean)=>act(()=>root.render(createElement(AssistantPresenceStatus,{snapshot,compact:true,unconfirmed})));
 await render(false);expect(container.querySelector('[data-presence-state]')?.getAttribute('data-presence-state')).toBe('present');
 await render(true);expect(container.querySelector('[data-presence-state]')?.getAttribute('data-presence-state')).toBe('unknown');
 expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Current availability: Unknown');
 await render(false);expect(container.querySelector('[data-presence-state]')?.getAttribute('data-presence-state')).toBe('present');
 expect(snapshot.effectivePresence).toBe('present');
});
