/**
 * Run the site's in-browser benchmark suites headlessly and emit a results file
 * with full provenance (R66: no number is published without saying where it came from).
 *
 *   tsx tools/run-bench.mts            → writes tools/bench-results.json
 *
 * Node/tsx only — Playwright's launch hangs under bun on macOS.
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { cpus } from 'node:os'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, '../dist/index.html')

const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
page.on('pageerror', (e: Error) => console.error('PAGEERROR', e.message))
await page.goto(`file://${dist}#/bench`)
await page.waitForTimeout(600)

/** Click every "Run" button, then read the rendered rows back out of the DOM. */
const buttons = await page.$$('button')
let started = 0
for (const b of buttons) {
  const label = ((await b.textContent()) ?? '').trim().toLowerCase()
  if (label === 'run' || label.startsWith('run ')) { await b.click(); started++ }
}
console.log(`started ${started} suites`)
await page.waitForTimeout(20_000)

const suites = await page.evaluate(() => {
  const out: { suite: string; rows: { name: string; ms: number }[] }[] = []
  for (const sec of Array.from(document.querySelectorAll('section'))) {
    const title = sec.querySelector('h2, h3')?.textContent?.trim()
    const rows = Array.from(sec.querySelectorAll('.bb, tr')).flatMap((r) => {
      const name = r.querySelector('.bb-name, td:first-child')?.textContent?.trim()
      const val = r.querySelector('.bb-ms, td:last-child')?.textContent?.trim()
      if (!name || !val) return []
      const ms = parseFloat(val.replace(/[^\d.]/g, ''))
      return Number.isFinite(ms) ? [{ name, ms }] : []
    })
    if (title && rows.length) out.push({ suite: title, rows })
  }
  return out
})

const ua = await page.evaluate(() => navigator.userAgent)
await browser.close()

const results = {
  schema: 1,
  provenance: {
    ranAt: new Date().toISOString(),
    commit,
    userAgent: ua,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    note: 'Headless Chromium on a developer machine. Absolute values are not comparable across machines; ratios within one run are.',
  },
  suites,
}
const out = join(here, 'bench-results.json')
writeFileSync(out, JSON.stringify(results, null, 2))
console.log(`\n${suites.length} suites → ${out}`)
for (const s of suites) {
  console.log(`\n## ${s.suite}`)
  for (const r of s.rows) console.log(`   ${r.ms.toString().padStart(9)}  ${r.name}`)
}
