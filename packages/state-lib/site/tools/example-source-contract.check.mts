import assert from 'node:assert/strict';
import { isExampleBackedSource } from './example-source-contract.mts';
const id = 'task-screen';
assert(isExampleBackedSource("{exampleById('task-screen')!.code}", id));
assert(isExampleBackedSource("{`${exampleById('task-screen')!.setup}\\n\\n${exampleById('task-screen')!.ui}`}", id));
assert(isExampleBackedSource("{exampleById('task-screen')!.setup + '\\n' + exampleById('task-screen')!.ui}", id));
assert(!isExampleBackedSource("{'copied but unrelated source'}", id));
assert(!isExampleBackedSource("{exampleById('undo')!.code}", id));
assert(!isExampleBackedSource("{`${exampleById('task-screen')!.setup}fake source`}", id));
assert(!isExampleBackedSource("{exampleById('task-screen')!.code.replace('a', 'b')}", id));
assert(!isExampleBackedSource("{'   '}", id));
assert(
  isExampleBackedSource(
    "{`${exampleById('task-screen')!.setup}\\n\\n${exampleById('task-screen')!.code}\\n\\n${exampleById('task-screen')!.ui}`}",
    id,
  ),
);
assert(!isExampleBackedSource("{`${exampleById('task-screen')!.setup}\\n\\n${exampleById('undo')!.code}`}", id));
assert(
  !isExampleBackedSource(
    "{`${exampleById('task-screen')!.setup}\\n// the prepared script\\n${exampleById('task-screen')!.code}`}",
    id,
  ),
);
console.info(
  'PASS: actual example fields survive formatting; wrong IDs, literal copies and transformed code are rejected',
);
