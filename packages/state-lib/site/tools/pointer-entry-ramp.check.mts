import assert from 'node:assert/strict';
import { POINTER_ENTRY_RAMP_MS, pointerEntryInfluence } from '../src/lib/useDragScroll';

assert.equal(POINTER_ENTRY_RAMP_MS, 450);
assert.equal(pointerEntryInfluence(-1), 0);
assert.equal(pointerEntryInfluence(0), 0);
assert.equal(pointerEntryInfluence(225), 0.5);
assert.equal(pointerEntryInfluence(450), 1);
assert.equal(pointerEntryInfluence(900), 1);
assert.equal(pointerEntryInfluence(0, true), 1);

console.log('pointer entry ramp: ok');
