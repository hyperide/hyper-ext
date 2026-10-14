import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.html')
const id = process.argv[2] ?? 'regions'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 1200 } })
await p.goto(`file://${dist}#/repl/${id}`)
await p.waitForTimeout(400)
await (await p.$('button:has-text("run")'))!.click()
await p.waitForTimeout(1200)
console.log((await p.$$eval('.repl-out > div', (ds: Element[]) => ds.map((d) => d.textContent ?? ''))).join('\n'))
await b.close()
