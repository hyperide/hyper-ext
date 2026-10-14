/** Execute positive and negative type contracts, not just TS transpilation. */
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', '../runtime/tsconfig.json'], {
  stdio: 'inherit',
});
console.log('reference runtime strict type contracts passed');
