/**
 * AI-based project structure analysis.
 * Extracted from server/services/project-analyzer.ts
 *
 * Uses LLM to analyze directory tree and identify component categories.
 */

import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { AI_PROVIDER_DEFAULTS } from '../../shared/ai-provider-defaults.js';
import { filterChildPaths } from './directory-tree.js';
import type { ProjectStructure } from './types.js';

export interface AIAnalyzerOptions {
  model: string;
  baseURL?: string;
  provider?: 'anthropic' | 'openai';
}

const AI_PROMPT = `You are analyzing a React/TypeScript project structure to find component directories.

Project structure:
{TREE}

TASK: Identify ALL directories containing components and categorize them IN THIS ORDER:

1. **atomComponentsPaths** (ARRAY of paths): Directories with ATOMIC/REUSABLE UI components
   - Definition: Small, self-contained, reusable UI primitives (Button, Input, Card, Badge, Icon, etc.)
   - Characteristics:
     * Low complexity, single responsibility
     * No business logic, pure presentation
     * Usually small files (< 100 lines)
     * Highly reusable across the app
   - Common directory names: "components", "ui", "atoms", "elements", "primitives"
   - Look for directories with multiple small .tsx files with generic names
   - Examples: "src/components/ui", "packages/ui/components", "app/components/atoms"

2. **compositeComponentsPaths** (ARRAY of paths): Directories with COMPOSITE/FEATURE components
   - Definition: Complex components composed from atoms, containing business logic
   - Characteristics:
     * Higher complexity, composed from multiple atoms
     * May contain business logic, state management
     * Feature-specific or page-specific components
     * Less reusable, more context-dependent
   - Common directory names: "examples", "features", "modules", "composites", "molecules"
   - Look for directories with larger .tsx files or subdirectories organizing features
   - Examples: "src/features", "app/modules", "packages/examples"

3. **pagesPaths** (ARRAY of paths): Directories with PAGE/ROUTE components
   - Definition: Top-level pages/routes that represent entire application screens
   - Characteristics:
     * File-based routing structure
     * Directory name is typically "pages" or "routes" (exact match preferred)
     * Files represent full application screens/routes
     * Usually ONE main pages directory per project
     * May contain route-specific logic
   - Common directory names: "pages" (most common), "routes", "screens", "views"
   - Framework patterns:
     * Next.js Pages Router: "pages/" or "src/pages/"
     * Next.js App Router: "app/" (only if contains route files like page.tsx, layout.tsx)
     * Remix: "app/routes/"
     * Vite/React: "src/pages/"
   - Examples: "src/pages", "pages", "app/routes", "apps/web/src/pages"
   - IMPORTANT: Usually only ONE pages directory per project, not multiple

4. **UI Component Paths** (SINGLE file path each): Find THE BEST styled component for each UI type

   **textComponentPath** (STRING or null): Best Text/Typography component
   - Look for: Text, Typography, Paragraph, Heading, Label components
   - Common names: "Text.tsx", "Typography.tsx", "text.tsx", "Label.tsx"
   - Prefer components from atomComponentsPaths directories
   - Choose components WITHOUT semantic styling (not for specific use cases)
   - Return the FULL FILE PATH, not just directory
   - Fallback: null (will use native span)

   **linkComponentPath** (STRING or null): Best Link/Anchor component
   - Look for: Link, Anchor, RouterLink components
   - Common names: "Link.tsx", "link.tsx", "Anchor.tsx"
   - Prefer components from atomComponentsPaths directories
   - Choose styled links that accept href prop
   - Return the FULL FILE PATH
   - Fallback: null (will use native a)

   **buttonComponentPath** (STRING or null): Best Button component
   - Look for: Button, Btn components
   - Common names: "Button.tsx", "button.tsx", "Btn.tsx"
   - Prefer components from atomComponentsPaths directories
   - Choose main button component (not IconButton, ToggleButton, etc.)
   - Return the FULL FILE PATH
   - Fallback: null (will use native button)

   **imageComponentPath** (STRING or null): Best Image component
   - Look for: Image, Picture, Img components
   - Common names: "Image.tsx", "image.tsx", "Picture.tsx"
   - Prefer components from atomComponentsPaths directories
   - Choose components that wrap img tag with styling
   - Return the FULL FILE PATH
   - Fallback: null (will use native img)

   **containerComponentPath** (STRING or null): Best Container/Layout component for grouping
   - Look for: Flex, Box, Stack, Container, Group components
   - Common names: "Flex.tsx", "Box.tsx", "Stack.tsx", "Container.tsx", "Group.tsx"
   - Prefer components from atomComponentsPaths directories
   - Choose components WITHOUT semantic/extra styling (NOT Card, Panel, Section)
   - Must be for LAYOUT/GROUPING only, not semantic containers
   - Return the FULL FILE PATH
   - Fallback: null (will use native div)

CRITICAL RULES:
- Process categories in order: atoms first, then composites, then pages, then UI components
- For directories: Return ALL matching directories as arrays, not just one
- For UI components: Return ONLY ONE best file path per component type (or null)
- A directory CANNOT be in multiple categories - choose the best fit based on primary purpose
- For pages: prefer directories with exact name "pages" or "routes" over generic names
- For pages: look for file-based routing patterns (multiple .tsx files representing routes)
- For UI components: must be FULL FILE PATHS (e.g., "client/components/ui/button.tsx"), not directories
- For UI components: prefer files from atomComponentsPaths directories
- Paths can be at ANY depth: "src/pages", "packages/app/pages", "apps/web/app/routes", etc.
- DO NOT assume "src/" structure - monorepos use various structures
- Paths must be relative to project root
- Prefer deeper/more specific paths over shallow ones
- If a directory contains multiple types in subdirectories, list the subdirectories separately
- IGNORE: "project-preview/" directory

Return ONLY a JSON object (no markdown, no backticks, no explanation):
{
  "atomComponentsPaths": ["path/to/atoms1", "path/to/atoms2"] or null,
  "compositeComponentsPaths": ["path/to/composites1", "path/to/features"] or null,
  "pagesPaths": ["path/to/pages1", "path/to/routes"] or null,
  "textComponentPath": "path/to/Text.tsx" or null,
  "linkComponentPath": "path/to/Link.tsx" or null,
  "buttonComponentPath": "path/to/Button.tsx" or null,
  "imageComponentPath": "path/to/Image.tsx" or null,
  "containerComponentPath": "path/to/Flex.tsx" or null
}`;

/**
 * Call an OpenAI Chat Completions-compatible API via fetch.
 * Works with OpenAI, Gemini, DeepSeek, Mistral, Groq, Qwen, etc.
 */
async function callOpenAICompatible(apiKey: string, baseURL: string, model: string, prompt: string): Promise<string> {
  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI-compatible API error ${response.status}: ${text}`);
  }
  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0].message.content;
}

/**
 * Analyze project structure using AI.
 * Supports both Anthropic SDK and OpenAI-compatible APIs based on options.provider.
 * Throws on failure — caller decides fallback strategy.
 */

export async function analyzeWithAI(
  projectPath: string,
  tree: string,
  apiKey: string,
  options: AIAnalyzerOptions,
): Promise<ProjectStructure> {
  const prompt = AI_PROMPT.replace('{TREE}', tree);
  let text: string;

  if (options.provider === 'openai') {
    const baseURL = options.baseURL || 'https://api.openai.com/v1';
    text = await callOpenAICompatible(apiKey, baseURL, options.model, prompt);
  } else {
    // Anthropic SDK path (claude, glm, resolved proxy)
    const anthropic = new Anthropic({
      apiKey,
      baseURL: options.baseURL || undefined,
    });

    const response = await anthropic.messages.create({
      model: options.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected AI response type');
    }
    text = content.text;
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in AI response');
  }

  const raw = JSON.parse(jsonMatch[0]) as ProjectStructure;

  // Filter child paths and convert to absolute
  return {
    atomComponentsPaths: raw.atomComponentsPaths
      ? filterChildPaths(raw.atomComponentsPaths).map((p) => join(projectPath, p))
      : [],
    compositeComponentsPaths: raw.compositeComponentsPaths
      ? filterChildPaths(raw.compositeComponentsPaths).map((p) => join(projectPath, p))
      : [],
    pagesPaths: raw.pagesPaths ? filterChildPaths(raw.pagesPaths).map((p) => join(projectPath, p)) : [],
    textComponentPath: raw.textComponentPath ? join(projectPath, raw.textComponentPath) : null,
    linkComponentPath: raw.linkComponentPath ? join(projectPath, raw.linkComponentPath) : null,
    buttonComponentPath: raw.buttonComponentPath ? join(projectPath, raw.buttonComponentPath) : null,
    imageComponentPath: raw.imageComponentPath ? join(projectPath, raw.imageComponentPath) : null,
    containerComponentPath: raw.containerComponentPath ? join(projectPath, raw.containerComponentPath) : null,
  };
}

/** Default base URLs for OpenAI Chat Completions-compatible providers */
const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  openai: 'https://api.openai.com/v1',
};

export interface ResolvedAIConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  provider: 'anthropic' | 'openai';
}

/**
 * Resolve provider config into a normalized form for analyzeWithAI.
 * For proxy/opencode providers, requires `backend` to identify the key type.
 * Returns null if the provider or config is unrecognized.
 */
export function resolveAnalyzerConfig(opts: {
  provider: string;
  apiKey: string;
  model: string;
  baseURL?: string;
  backend?: string;
}): ResolvedAIConfig | null {
  const { provider, apiKey, model, baseURL, backend } = opts;

  switch (provider) {
    case 'claude':
      return { apiKey, model, baseURL, provider: 'anthropic' };

    case 'glm':
      return {
        apiKey,
        model,
        baseURL: baseURL || AI_PROVIDER_DEFAULTS.glm.baseURL,
        provider: 'anthropic',
      };

    case 'openai':
      return {
        apiKey,
        model,
        baseURL: baseURL || 'https://api.openai.com/v1',
        provider: 'openai',
      };

    case 'proxy':
    case 'opencode': {
      const b = backend;
      if (!b) return null;

      // anthropic key type still uses Anthropic SDK
      if (b === 'anthropic') {
        return { apiKey, model, provider: 'anthropic' };
      }

      const resolvedBaseURL = OPENAI_COMPATIBLE_BASE_URLS[b];
      if (!resolvedBaseURL) return null;

      return { apiKey, model, baseURL: resolvedBaseURL, provider: 'openai' };
    }

    default:
      return null;
  }
}
