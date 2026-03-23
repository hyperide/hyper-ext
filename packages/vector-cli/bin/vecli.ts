#!/usr/bin/env bun
/**
 * @file vecli entry point — mode detection and arg parsing
 *
 * Accessed via: `vecli` command in terminal
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { runBatch } from '../src/batch';

const args = process.argv.slice(2);

// Parse flags
let execFile: string | undefined;
let outputFile: string | undefined;
let canvasWidth = 100;
let canvasHeight = 100;
let expression: string | undefined;

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
  if (arg === '--canvas') {
    const parts = args[++i].split('x').map(Number);
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
      canvasWidth = parts[0];
      canvasHeight = parts[1];
    }
    continue;
  }
  if (arg === '-h' || arg === '--help') {
    printHelp();
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

function printHelp(): void {
  console.log(`vecli — Vector Engine CLI

Usage:
  vecli                              Interactive TUI mode
  vecli 'expression'                 Evaluate inline expression
  vecli -e script.js                 Execute script file
  echo 'expr' | vecli               Pipe stdin

Flags:
  -e, --exec <file>     Execute script file
  -o, --output <file>   Output file (default: stdout)
  --canvas <WxH>        Canvas size (default: 100x100)
  -h, --help            Show help
  -v, --version         Show version

Examples:
  vecli 'rect(100,50).fill("#f00").svg()'
  vecli -e icon.js -o icon.svg
  vecli --canvas 24x24 -e icon.js`);
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
    } else if (!code && !isTTY) {
      // Read from stdin pipe
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      code = Buffer.concat(chunks).toString('utf-8');
    }

    try {
      const output = runBatch({ expression: code, canvasWidth, canvasHeight });
      if (outputFile) {
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
    // TUI mode placeholder
    console.log('vecli — Interactive TUI mode (coming soon)');
    console.log('');
    console.log('For now, use batch mode:');
    console.log('  vecli \'rect(100,50).fill("#f00").svg()\'');
    console.log('  vecli -e script.js');
    console.log('  vecli --help');
  }
}

main();
