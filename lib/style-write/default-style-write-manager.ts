/**
 * @file Default StyleWriteManager factory with the shared adapter registry
 *
 * Accessed via: SaaS and VS Code style update request handlers before mutating user files
 * Assumptions: inline-style remains registered as the universal fallback adapter.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { cssModulesAdapter } from '@lib/style-adapters/css-modules';
import { inlineStyleAdapter } from '@lib/style-adapters/inline-style';
import { tailwindV4Adapter } from '@lib/style-adapters/tailwind-v4';
import { tamaGuiAdapter } from '@lib/style-adapters/tamagui';
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
  const adapters = options.adapters ?? [tailwindV4Adapter, cssModulesAdapter, tamaGuiAdapter, inlineStyleAdapter];
  return new DefaultStyleWriteManager({
    planner: new DefaultStyleWritePlanner(adapters),
    executor: options.executor,
  });
}
