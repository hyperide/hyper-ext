/**
 * The hover index is generated from the prototype's real types and must not
 * lag behind them. Same shape as facts-freshness: regenerate in memory, compare
 * with what is committed, fail on a difference — because a stale index means the
 * hover shows a signature the code no longer has, which is worse than none.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const r = spawnSync('tsx', [resolve(here, 'gen-api-docs.mts'), '--check'], { encoding: 'utf8' })
const out = (r.stdout + r.stderr).trim().split('\n').filter((l) => !/Deprecat|trace-dep/.test(l)).join('\n')
console.log(out)
console.log(r.status === 0 ? '\nall assertions passed' : '\n1 check(s) failed')
process.exit(r.status === 0 ? 0 : 1)
