/**
 * Shared prompt builder and response extractor for AI sample generation.
 *
 * Used by both server (parseComponent.ts) and VS Code extension (SampleAIGenerator.ts).
 * Server appends framework-specific instructions via the optional parameter.
 */

/**
 * Build a prompt for AI to generate a Sample* component.
 * The base prompt covers React/TypeScript conventions, structure rules,
 * and container/wrapper component handling.
 *
 * @param frameworkInstructions - Optional framework-specific block (routing, providers, etc.)
 *   The server adds instructions for Next.js App/Pages Router, React Router, Remix, Solito.
 *   The extension passes nothing (framework detection happens at the server level).
 */
export function buildSamplePrompt(sourceCode: string, sampleName: string, frameworkInstructions?: string): string {
  const frameworkBlock = frameworkInstructions ? `\n${frameworkInstructions}\n` : '';

  return `Analyze this React/TypeScript component and generate a ${sampleName} component.

Component file:
\`\`\`tsx
${sourceCode}
\`\`\`

Task: Create an \`export const ${sampleName}\` component that demonstrates this component.

Requirements:
1. Return ONLY the TypeScript/JSX code, NO explanations or markdown
2. Component signature: \`export const ${sampleName} = () => { ... }\`
   - IMPORTANT: Use PascalCase "${sampleName}" — required for React Fast Refresh HMR
3. Return JSX that renders the component with realistic, meaningful props
4. Analyze the component's TypeScript interface/props to provide correct prop types
5. If component needs children, provide realistic child content
6. If component needs data arrays, provide 2-3 example items
7. Use realistic example data (not "foo", "bar", "test")
8. Keep it concise — just enough to show the component working
9. **IMPORTANT**: Find the ACTUAL exported component name from the code (look for \`export default\`, \`export function\`, or \`export const\`)
   - DO NOT use the filename as component name
   - For dynamic routes like [id].tsx, the component is usually named differently (e.g., UserPage, ProductDetail, etc.)
   - If component uses special characters in filename, use the actual exported name from the code
10. **CONTAINER/WRAPPER COMPONENTS**: If component name contains Viewport, Portal, Provider, Container, Toast, Modal, Dialog, Popover, Dropdown, Menu, Sheet, or Drawer:
   - These components are EMPTY by default — they only display when they have content
   - You MUST provide visible child content or set open/visible state to true
   - For Toast/Notification: wrap in Provider and include actual Toast with open={true}
   - For Modal/Dialog/Sheet/Drawer: set open={true} and include content
   - For Viewport/Portal: include sample items that would appear inside
   - For Provider: wrap child components that demonstrate the context value
${frameworkBlock}
FORBIDDEN:
- NO jest.mock(), vitest.mock(), or any test mocking utilities
- NO \`as jest.Mock\`, \`as Mock\`, or any type assertions to Mock types
- NO duplicating imports that are ALREADY in the component file
- Use ONLY runtime approaches (MemoryRouter for react-router, props for Next.js App Router, wrapper for Next.js Pages Router)

CRITICAL STRUCTURE RULES:
- THE COMPONENT IS ALREADY DEFINED IN THIS FILE — you are appending ${sampleName} to the SAME file
- DO NOT import the component itself — it's already exported in this file
- DO NOT import anything that's already imported at the top of this file
- Imports MUST be at the TOP of the code, OUTSIDE the component
- NO imports inside the return statement
- NO duplicate function declarations
- Only add imports for NEW external dependencies
- Structure: NEW imports only (if needed) → blank line → export const ${sampleName}

Generate ONLY the code now:`;
}

/**
 * Strip markdown code fences from AI response and validate basic structure.
 * Returns null if the response doesn't look like valid component code.
 */
export function extractCodeFromAIResponse(raw: string): string | null {
  let code = raw.trim();

  // Match code fences: ```lang\n...\n``` or ```lang\n...```  (no trailing newline)
  // Supported language tags: tsx, ts, jsx, js, typescript, javascript, or none
  const fenceRe = /```(?:tsx?|jsx?|typescript|javascript)?\s*\n([\s\S]*?)(?:\n```|```)$/;

  // Try all fences in case the first one is non-code (e.g. ```text)
  const allFences = [...code.matchAll(/```(\w*)\s*\n([\s\S]*?)(?:\n```|```)/g)];
  const codeLangs = new Set(['tsx', 'ts', 'jsx', 'js', 'typescript', 'javascript', '']);
  let extracted: string | null = null;

  for (const fence of allFences) {
    const lang = fence[1];
    if (codeLangs.has(lang)) {
      extracted = fence[2].trim();
      break;
    }
  }

  if (!extracted) {
    // Fallback: single fence match
    const codeMatch = code.match(fenceRe);
    if (codeMatch) {
      extracted = codeMatch[1].trim();
    }
  }

  if (extracted) {
    code = extracted;
  }

  if (!code.startsWith('export') && !code.startsWith('import')) {
    return null;
  }

  return code;
}
