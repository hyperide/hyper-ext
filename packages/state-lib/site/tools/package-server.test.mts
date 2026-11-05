import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const directory = '.vercel/output/functions/api/measurements.func';
const config = JSON.parse(readFileSync(join(directory, '.vc-config.json'), 'utf8'));
assert.equal(config.filePathMap, undefined, 'Function must not reference files outside its artifact');
assert(existsSync(join(directory, 'node_modules/pg/package.json')), 'Include PostgreSQL driver inside function');
const temporary = mkdtempSync(join(tmpdir(), 'state-packaged-function-'));
try {
  const isolated = join(temporary, 'function');
  cpSync(directory, isolated, { recursive: true });
  const handler = pathToFileURL(join(isolated, config.handler)).href;
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('STATE_MEASUREMENTS_') && name !== 'NODE_PATH'),
  );
  const script = `const {Pool}=await import('pg');
const pool=new Pool();await pool.end();
const {default:handler}=await import(process.argv[1]);
const response={statusCode:0,setHeader(){},end(value){if(this.statusCode!==503||!JSON.parse(value).error)throw Error('Unconfigured service must fail closed');}};
await handler({method:'GET',headers:{},url:'/api/measurements'},response);
if(response.statusCode!==503)throw Error('Handler did not respond');`;
  execFileSync(process.execPath, ['--input-type=module', '-e', script, handler], {
    cwd: isolated,
    env: environment,
    stdio: 'pipe',
    timeout: 20000,
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log('PASS: isolated artifact constructs pg.Pool and fails closed without credentials');
