import { Runtime } from './core';
import { latestTask, type LatestOutcome } from './latest-task';

const runtime = new Runtime();
const value = runtime.signal(0);
const task = latestTask(
  runtime,
  async (date: string, signal) => {
    signal.throwIfAborted();
    return date.length;
  },
  (length, date) => {
    value.set(length + date.length);
  },
);
const result: Promise<LatestOutcome> = task.run('2026-09-16');
void result;
// @ts-expect-error The input type is preserved across load and commit.
task.run(123);

const readNumber = (input: number) => input;
const asyncCommit = async (input: number) => {
  value.set(input);
};
// @ts-expect-error Result publication must remain synchronous.
latestTask(runtime, readNumber, asyncCommit);

const numberFromString = (_input: string) => 1;
const commitString = (input: string) => value.set(input.length);
// @ts-expect-error A mismatched result cannot coerce the loader output.
latestTask(runtime, numberFromString, commitString);
