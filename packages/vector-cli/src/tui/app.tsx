/**
 * @file Interactive TUI root component (ink) — expression input + live SVG preview
 *
 * Accessed via: `vecli` with no args in a TTY (see bin/vecli.ts -> startTui).
 *
 * Assumptions: deliberately minimal — an input line, a live preview pane showing
 * the SVG markup (or the evaluation error), and a footer. The full node/graph/
 * properties panel layout from the design spec is a deferred follow-up.
 */

import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useState } from 'react';
import type { PathOpsBackend } from 'vector-wasm';
import { evaluateExpression } from './evaluate';

export interface AppProps {
  canvasWidth?: number;
  canvasHeight?: number;
  /** Real PathOps backend; omit for the MockPathOps no-op stub. */
  pathOps?: PathOpsBackend;
}

export function App({ canvasWidth, canvasHeight, pathOps }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [value, setValue] = useState('');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  useInput((input, key) => {
    // Ctrl+Q / Ctrl+C quits.
    if ((key.ctrl && input === 'q') || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  const handleSubmit = (expr: string): void => {
    const result = evaluateExpression(expr, { canvasWidth, canvasHeight, pathOps });
    setSvg(result.svg);
    setError(result.error);
    // Clear the prompt so the next command starts fresh — otherwise the controlled
    // input keeps the submitted text and the next keystrokes append to it.
    setValue('');
  };

  return (
    <Box flexDirection="column" width="100%">
      <Box>
        <Text bold color="cyan">
          vecli
        </Text>
        <Text dimColor> — interactive TUI</Text>
      </Box>

      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">{'> '}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder='rect(100,50).fill("#f00").svg()'
        />
      </Box>

      <Box flexDirection="column" borderStyle="round" paddingX={1} minHeight={6}>
        <Text bold dimColor>
          Preview
        </Text>
        {error ? (
          <Text color="red">Error: {error}</Text>
        ) : svg ? (
          <Text>{svg}</Text>
        ) : (
          <Text dimColor>Type an expression and press Enter.</Text>
        )}
      </Box>

      <Box>
        <Text dimColor>Enter: run · Ctrl+Q: quit</Text>
      </Box>
    </Box>
  );
}
