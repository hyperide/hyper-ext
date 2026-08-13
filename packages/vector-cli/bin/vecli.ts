#!/usr/bin/env bun
/**
 * @file vecli entry point — mode detection and arg parsing
 *
 * Accessed via: `vecli` command in terminal
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { runBatch } from '../src/batch';
import { getHelp } from '../src/help';
import { svgToPng } from '../src/png';

const args = process.argv.slice(2);

// `vecli mcp` — serve the vector-engine MCP tools over stdio. Dynamic import keeps
// the MCP SDK off the batch hot path (same pattern as the TUI branch below).
if (args[0] === 'mcp') {
  const { serveMcpStdio } = await import('../src/mcp/stdio');
  await serveMcpStdio();
  process.exit(0);
}

// Parse flags
let execFile: string | undefined;
let outputFile: string | undefined;
let canvasWidth: number | undefined;
let canvasHeight: number | undefined;
let expression: string | undefined;
let format: 'svg' | 'png' = 'svg';

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-e' || arg === '--exec') {
    execFile = args[++i];
    continue;
  }
  if (arg === '-o' || arg === '--output') {
    outputFile = args[++i];
    continue;
  }
  if (arg === '--format') {
    const val = args[++i];
    if (val === 'png') format = 'png';
    continue;
  }
  if (arg === '--canvas') {
    const parts = args[++i].split('x').map(Number);
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
      canvasWidth = parts[0];
      canvasHeight = parts[1];
    }
    continue;
  }
  if (arg === '-h' || arg === '--help') {
    const topic = args[i + 1];
    // Only consume next arg if it doesn't look like a flag
    const helpTopic = topic && !topic.startsWith('-') ? topic : undefined;
    if (helpTopic) i++;
    console.log(getHelp(helpTopic));
    process.exit(0);
  }
  if (arg === '-v' || arg === '--version') {
    console.log('vecli 0.0.1');
    process.exit(0);
  }
  // First non-flag arg is inline expression
  if (!arg.startsWith('-') && !expression) {
    expression = arg;
  }
}

// Detect mode
const isTTY = process.stdin.isTTY && process.stdout.isTTY;
const hasBatchArgs = expression || execFile;

async function main(): Promise<void> {
  if (hasBatchArgs || !isTTY) {
    // Batch mode
    let code = expression ?? '';

    if (execFile) {
      code = readFileSync(execFile, 'utf-8');
    }

    // Read stdin only if explicitly piped (not TTY) AND we need it
    // Skip stdin read if we already have code from -e or inline expression
    // to avoid hanging when stdin is a pipe with no data
    if (!process.stdin.isTTY && !code) {
      // No expression — stdin IS the code
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      code = Buffer.concat(chunks).toString('utf-8').trimEnd();
    }

    try {
      const output = runBatch({ expression: code, canvasWidth, canvasHeight });

      if (format === 'png' && output) {
        const pngBuf = svgToPng(output);
        if (outputFile) {
          writeFileSync(outputFile, pngBuf);
        } else {
          process.stdout.write(pngBuf);
        }
      } else if (outputFile) {
        writeFileSync(outputFile, output);
      } else if (output) {
        process.stdout.write(output);
        // Add newline if stdout is a TTY (for clean prompt)
        if (process.stdout.isTTY) process.stdout.write('\n');
      }
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  } else {
    // Interactive TUI mode. Dynamic import keeps ink/react off the batch hot path.
    const { startTui } = await import('../src/tui/index');
    await startTui({ canvasWidth, canvasHeight });
  }
}

main();
