/**
 * @file Default StyleReadManager factory with the shared adapter registry
 *
 * Accessed via: SaaS and VS Code style inspector read handlers before rendering source tabs
 * Assumptions: adapter readers only derive source ownership from already-collected
 *   element facts; filesystem and runtime tracing stay at the platform boundary.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { CssModulesReader } from '@lib/style-adapters/css-modules/reader';
import { InlineStyleReader } from '@lib/style-adapters/inline-style/reader';
import { TailwindV4Reader } from '@lib/style-adapters/tailwind-v4/reader';
import type { FrameworkStyleAdapter } from '@lib/style-write/types';
import { DefaultStyleReadManager } from './style-read-manager';
import type { StyleReadManager } from './types';

export interface CreateDefaultStyleReadManagerOptions {
  adapters?: FrameworkStyleAdapter[];
}

export function createDefaultStyleReadManager(options: CreateDefaultStyleReadManagerOptions = {}): StyleReadManager {
  const adapters = options.adapters ?? [
    { id: 'tailwind-v4', reader: new TailwindV4Reader() },
    { id: 'css-modules', reader: new CssModulesReader() },
    { id: 'inline-style', reader: new InlineStyleReader() },
  ];
  return new DefaultStyleReadManager({ adapters });
}
