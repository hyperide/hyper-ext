/**
 * R34 comprehension protocol, step 1 — render each concept figure in isolation.
 *
 * The protocol: show a figure to a model that has NOT been told what it depicts,
 * ask what it understands, then add context in rounds. A figure that only becomes
 * legible once you already know the concept is decoration, not explanation.
 *
 * Isolation matters. A figure read inside the full Concepts page is propped up by
 * the surrounding prose, so it always looks clearer than it is. Here each figure is
 * rendered alone, with the site's own stylesheet, exactly as a cold reader meets it.
 *
 *   cd packages/state-lib/site && tsx tools/render-figures.mts
 *   → writes tools/.figures/<id>.png  (git-ignored)
 *
 * Then hand the PNG paths to subagents with no context and collect their readings.
 * Run under node/tsx, never bun: Playwright's launch hangs under bun on macOS.
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(here, '.figures')

const fragment = readFileSync(join(root, 'src/content/concepts-fragment.html'), 'utf8')
const css = readFileSync(join(root, 'src/state.css'), 'utf8')

/** Pull every <figure> out of the concepts fragment, keyed by its section id. */
function extractFigures(html: string): { id: string; figure: string }[] {
  const out: { id: string; figure: string }[] = []
  const section = /<section class="concept" id="([^"]+)"([\s\S]*?)<\/section>/g
  for (const m of html.matchAll(section)) {
    const figure = /<figure class="fig"[\s\S]*?<\/figure>/.exec(m[2])
    if (figure) out.push({ id: m[1], figure: figure[0] })
  }
  return out
}

/** One figure, the real stylesheet, nothing else on the page. */
function standalonePage(figure: string): string {
  return `<!doctype html><meta charset=utf-8><style>${css}
body{margin:0;background:#fff;padding:24px;max-width:760px}figure{margin:0}</style>
${figure}`
}

async function renderAll(figures: { id: string; figure: string }[]) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 })
  try {
    for (const { id, figure } of figures) {
      const htmlPath = join(outDir, `${id}.html`)
      writeFileSync(htmlPath, standalonePage(figure))
      await page.goto(`file://${htmlPath}`)
      await page.waitForTimeout(250)
      const el = await page.$('figure')
      if (!el) throw new Error(`no <figure> rendered for ${id}`)
      await el.screenshot({ path: join(outDir, `${id}.png`) })
      console.log(`rendered ${id}`)
    }
  } finally {
    await browser.close()
  }
}

mkdirSync(outDir, { recursive: true })
const figures = extractFigures(fragment)
if (figures.length === 0) throw new Error('no figures found in concepts-fragment.html')
await renderAll(figures)
console.log(`\n${figures.length} figures → ${outDir}`)
