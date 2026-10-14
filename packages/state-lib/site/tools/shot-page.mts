/** Screenshot site routes from the built single-file bundle (hash routing on file://). */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, '../dist/index.html')
const out = join(here, '.figures')
const routes = process.argv.slice(2)
if (!routes.length) throw new Error('usage: tsx tools/shot-page.mts /route [/route…]')
mkdirSync(out, { recursive: true })
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 })
p.on('pageerror', (e: Error) => console.error('PAGEERROR', e.message))
for (const r of routes) {
  await p.goto(`file://${dist}#${r}`)
  await p.waitForTimeout(500)
  const name = (r === '/' ? 'home' : r.slice(1).replace(/\//g, '-'))
  await p.screenshot({ path: join(out, `page-${name}.png`), fullPage: true })
  console.log('shot', r)
}
await b.close()
