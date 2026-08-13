/**
 * Host-only fs gatherer for the support-dimension classifier (HYP-788).
 *
 * Accessed via: extension host (runProjectDetection) — reads the active (sub-)repo's
 * package.json + source, builds the framework render gate + per-member CSS set, and feeds
 * the PURE classifier (support-dimensions.ts → classifySupportDimensions).
 *
 * Kept SEPARATE from support-dimensions.ts because this module imports ProjectDetector
 * (which imports node:fs). support-dimensions.ts must stay fs-free so the browser webview
 * can import its pure filter (selectDimensionTabs) without dragging node:fs into the bundle
 * (the class of leak scripts/check-webview-bundles.mjs guards).
 */

import {
  detectCssSystems,
  detectPackageManager,
  detectProjectType,
  detectUnsupportedProject,
  hasReactSourceFiles,
  readPackageJson,
} from './ProjectDetector';
import { classifySupportDimensions, type FrameworkGate, type FrameworkRenderKind } from './support-dimensions';
import type { ProjectType, SupportDimension, UnsupportedProjectError } from '../types';

/** Primitives the extension host already computed — reused to avoid re-detecting. */
export interface SupportDimensionsInput {
  /** Bundler/project type (detectProjectType). */
  projectType: ProjectType;
  /** The RN/Tamagui needs-setup signal (detectUnsupportedProject) — reused, not re-derived. */
  projectError: UnsupportedProjectError | null;
  /** Detected package manager (detectPackageManager). */
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun';
}

function depsOf(pkg: Record<string, unknown> | null | undefined): Record<string, string> {
  return {
    ...(pkg?.dependencies as Record<string, string> | undefined),
    ...(pkg?.devDependencies as Record<string, string> | undefined),
  };
}

/**
 * Resolve the framework render kind (vue/svelte/angular/react-native/react/none) from a
 * member's OWN package.json, falling back to a source scan for the no-dependency case.
 * RN takes precedence over react (an RN app declares both) so the RN needs-setup gate fires.
 */
export async function detectFrameworkRenderKind(
  projectPath: string,
  packageJson?: Record<string, unknown> | null,
): Promise<FrameworkRenderKind> {
  const deps = depsOf(packageJson);
  if (deps.vue || deps['@vue/core']) return 'vue';
  if (deps.svelte) return 'svelte';
  if (deps['@angular/core']) return 'angular';
  if (deps['react-native']) return 'react-native';
  if (deps.react) return 'react';
  return (await hasReactSourceFiles(projectPath)) ? 'react' : 'none';
}

/**
 * Build the framework gate, reusing the host's already-computed react-native projectError
 * for the needs-setup signal so the two surfaces never diverge.
 */
async function resolveFrameworkGate(
  projectPath: string,
  packageJson: Record<string, unknown> | null | undefined,
  projectError: UnsupportedProjectError | null,
): Promise<FrameworkGate> {
  if (projectError?.type === 'react-native') {
    return {
      kind: 'react-native',
      message: projectError.message,
      fixLabel: projectError.fixLabel ?? 'Fix: Add react-native-web',
    };
  }
  // A 'react-native' render kind WITHOUT a host RN projectError means react-native-web is
  // already installed (detectUnsupportedProject returned null) — it renders like React, so
  // the framework dimension is supported. The needs-setup gate fires ONLY via projectError.
  const kind = await detectFrameworkRenderKind(projectPath, packageJson);
  return { kind: kind === 'react-native' ? 'react' : kind };
}

/**
 * Gather facts for the active (sub-)repo and classify all five dimensions. Reuses the
 * primitives the host already detected (projectType, projectError, packageManager) and
 * adds the per-member CSS set (detectCssSystems) + framework render gate.
 */
export async function gatherSupportDimensions(
  projectPath: string,
  packageJson: Record<string, unknown> | null | undefined,
  input: SupportDimensionsInput,
): Promise<SupportDimension[]> {
  const [cssSystems, frameworkGate] = await Promise.all([
    detectCssSystems(projectPath, packageJson),
    resolveFrameworkGate(projectPath, packageJson, input.projectError),
  ]);
  return classifySupportDimensions({
    frameworkGate,
    bundler: input.projectType,
    cssSystems,
    packageManager: input.packageManager,
  });
}

/**
 * Convenience wrapper that reads a root's package.json + detects all the primitives
 * (projectType / projectError / packageManager) itself, then classifies the dimensions.
 * Single source of truth for "compute the support breakdown for this exact root" — used by
 * the selection hook AND by the react-native fix command (so a successful fix clears the
 * stale needs-setup tab). The hot activation path computes the primitives once and calls
 * gatherSupportDimensions directly to avoid re-detecting them.
 */
export async function computeSupportDimensionsForRoot(root: string): Promise<SupportDimension[]> {
  const pkg = await readPackageJson(root);
  const [projectType, projectError, packageManager] = await Promise.all([
    detectProjectType(root),
    detectUnsupportedProject(root, pkg),
    detectPackageManager(root),
  ]);
  return gatherSupportDimensions(root, pkg, { projectType, projectError, packageManager });
}
