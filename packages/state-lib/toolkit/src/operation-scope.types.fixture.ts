/** @file Compile-only consumer contract; never execute this fixture. */
import type {
  GateResult,
  OperationDiagnostics,
  OperationEvent,
  OperationEventKind,
  OperationLane,
  OperationLease,
  OperationScope,
  OperationScopeOptions,
  RevocationReason,
} from './operation-scope.js';

declare const scope: OperationScope;
const options: OperationScopeOptions = { traceCapacity: 64 };
const lane: OperationLane = Symbol('width');
const operation: OperationLease = scope.begin(lane);
const result: GateResult<number> = operation.commit(() => 42);
if (result.status === 'applied') {
  const value: number = result.value;
  void value;
} else {
  const reason: RevocationReason = result.reason;
  void reason;
  // @ts-expect-error Dropped operations have no applied value.
  void result.value;
}
const diagnostics: OperationDiagnostics = scope.diagnostics();
for (const event of diagnostics.trace) {
  const typed: OperationEvent = event;
  const kind: OperationEventKind = typed.kind;
  void kind;
}

// @ts-expect-error Commit callbacks may not cross await.
operation.commit(async () => 42);
// @ts-expect-error Feedback is synchronous; gate after await, not around it.
operation.notify(async () => 42);
// @ts-expect-error A lane is a string or symbol identity.
scope.begin(42);
// @ts-expect-error Applied results retain their value type.
const bad: GateResult<string> = operation.commit(() => 42);
// @ts-expect-error Invalid JavaScript options also fail statically.
const invalid: OperationScopeOptions = { traceCapacity: null };
void options;
void bad;
void invalid;

const feedbackScope: OperationScope = scope;
const report = feedbackScope.begin('width').bind((value: number, unit: string) => `${value}${unit}`);
const output = report(120, 'px');
if (output.status === 'applied') {
  const value: string = output.value;
  void value;
}
// @ts-expect-error Bound feedback preserves its argument types.
report('wrong', 'px');
// @ts-expect-error Bound feedback preserves its argument count.
report(120);
// @ts-expect-error Bound feedback cannot defer its protected work across await.
feedbackScope.begin('height').bind(async () => 1);
feedbackScope.dispose();
