import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPrivacyWriterCalls } from './check-privacy-writers.mjs';

test('privacy writer scanner detects unguarded, aliased, delayed and direct-storage writes', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bycoda-privacy-scanner-'));
  const src=path.join(root,'src');
  const checks=path.join(root,'scripts','checks');
  fs.mkdirSync(src); fs.mkdirSync(checks,{recursive:true});
  const file=path.join(src,'example.ts');
  const baseline=path.join(checks,'privacy-writer-exceptions.json');
  fs.writeFileSync(baseline, JSON.stringify({version:1,exceptions:[]}));
  try {
    fs.writeFileSync(file, `import { setProjectGroupAssignment as move } from './projectGroups';
      withRoomPrivacyMutation(() => move('/safe', 'g'));
      move('/unsafe', 'g');
      withRoomPrivacyMutation(() => setTimeout(() => move('/late','g'), 0));
      localStorage.setItem('bycoda.recentProjects','[]');`);
    const findings=checkPrivacyWriterCalls({root});
    assert.equal(findings.length,3);
    assert.deepEqual(findings.map(item=>item.name),['setProjectGroupAssignment','setProjectGroupAssignment','localStorage.setItem']);
  } finally {
    fs.unlinkSync(file); fs.unlinkSync(baseline);
    fs.rmdirSync(src); fs.rmdirSync(checks); fs.rmdirSync(path.join(root,'scripts')); fs.rmdirSync(root);
  }
});
