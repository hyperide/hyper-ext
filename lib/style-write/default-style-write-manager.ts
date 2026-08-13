/**
 * @file Default StyleWriteManager factory with the shared adapter registry
 *
 * Accessed via: SaaS and VS Code style update request handlers before mutating user files
 * Assumptions: inline-style remains registered as the universal fallback adapter.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { DEFAULT_STYLE_ADAPTERS } from '@lib/style-adapters/registry';
import { DefaultStyleWriteManager, type StyleWritePlanExecutor } from './style-write-manager';
import { DefaultStyleWritePlanner } from './style-write-planner';
import type { FrameworkStyleAdapter, StyleWriteManager } from './types';

export interface CreateDefaultStyleWriteManagerOptions {
  executor: StyleWritePlanExecutor;
  adapters?: FrameworkStyleAdapter[];
}

/**
 * Construct the shared StyleWriteManager with the default adapter registry
 * (Tailwind v4, CSS Modules, Tamagui, inline-style). The platform supplies the
 * `executor` (the only piece that actually mutates files); the manager wires the
 * planner over the adapter set so write routing is identical across SaaS and the
 * VS Code extension. inline-style MUST stay in the set — it is the universal
 * fallback writer the planner falls through to (see DefaultStyleWritePlanner).
 */
export function createDefaultStyleWriteManager(options: CreateDefaultStyleWriteManagerOptions): StyleWriteManager {
  // Spec §3.3 (Adapters — System B): the default writer order lives in the shared registry so the
  // write manager and the inspector's writable gate read from one source and can never disagree.
  const adapters = options.adapters ?? [...DEFAULT_STYLE_ADAPTERS];
  return new DefaultStyleWriteManager({
    planner: new DefaultStyleWritePlanner(adapters),
    executor: options.executor,
  });
}
