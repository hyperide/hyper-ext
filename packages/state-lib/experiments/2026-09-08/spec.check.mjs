import {test} from 'node:test';import assert from 'node:assert/strict';
import {composeSpec} from '../../site/src/lib/spec-compose.mjs';
test('spec modules are inserted before the requested chapter',()=>{assert.equal(composeSpec('## 4. Model\na\n## 5. Compiler',[[5,'NEW']]),'## 4. Model\na\nNEW\n\n## 5. Compiler');});
test('headings and shorter fences inside code are not insertion points',()=>{const source='````md\n## 5. Not a heading\n```\n````\n## 5. Real heading';assert.equal(composeSpec(source,[[5,'NEW']]),'````md\n## 5. Not a heading\n```\n````\nNEW\n\n## 5. Real heading');});
test('missing spec chapter fails explicitly instead of silently dropping a module',()=>assert.throws(()=>composeSpec('## 4. Model',[[5,'NEW']])));
