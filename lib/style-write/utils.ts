/**
 * @file Shared helpers for style-write planning and execution
 *
 * Accessed via: StyleWriteManager, StyleWritePlanner, and StyleWriteExecutor internals
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
