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

export function createDefaultStyleWriteManager(options: CreateDefaultStyleWriteManagerOptions): StyleWriteManager {
  const adapters = options.adapters ?? [tailwindV4Adapter, cssModulesAdapter, tamaGuiAdapter, inlineStyleAdapter];
  return new DefaultStyleWriteManager({
    planner: new DefaultStyleWritePlanner(adapters),
    executor: options.executor,
  });
}
