# Spec: Landing Page + VS Code Marketplace Copy & Design Overhaul

- **Date:** 2026-07-02
- **Requested by:** Alex (tg#5750)
- **Status:** Proposal — copy + design spec only, no implementation in this PR
- **Surfaces:** `https://hyperi.de` landing (source: `client/pages/Product/`) and the
  VS Code Marketplace listing `hyperide.hypercanvas-preview` (source:
  `vscode-extension/hypercanvas-preview/README.md` + `package.json`), plus the Open VSX
  mirror.

## 1. Goal and non-goals

**Goal.** Sharpen the positioning of both marketing surfaces around what actually
differentiates HyperIDE, rewrite the copy to be benefit-led and factually grounded,
give the marketplace listing a concise utilitarian install-and-first-win framing, and
propose a bolder landing design direction that is implementable.

**Non-goals.**
- No product behavior changes. No implementation of the copy/design in this PR.
- No fake social proof, no invented features, no benchmark numbers we cannot reproduce.
- SaaS onboarding funnel design (the SaaS is not publicly launched; see open questions).

## 2. Research: current state

### 2.1 Landing page (hyperi.de, redirects to `/product`)

Deployed copy verified identical to `client/pages/Product/*` source (grepped the
deployed JS chunk for the hero strings). Structure: `Hero → Features → HowItWorks →
Demo → FAQ → Footer`.

Current copy, verbatim:

| Slot | Current text |
|---|---|
| Badge | "VS Code Extension" (with green ping dot) |
| H1 | "Visual React Editor **with AI Superpowers**" (gradient on line 2) |
| Subhead | "Install HyperIDE in VS Code or Cursor, open your React project, and edit the real running UI with visual controls, code navigation, and AI context actions." |
| CTAs | "VS Code" / "Cursor · Windsurf" / "GitHub" / "Open SaaS (soon)" (disabled) |
| Features H2 | "Everything you need to build faster" |
| Feature cards | Visual Editing, AI Assistant, Live Preview, Framework Support, Extension Workflow (5 generic icon cards) |
| HowItWorks H2 | "How it works" — 3 steps: Inspect the Live Tree / Edit Visually / Use Context Actions |
| Demo H2 | "Built for developers who value their time" + 9 capability badges + "Select / Inspect / Act" stats |
| FAQ | 6 questions; includes "HyperIDE is open source." |
| Footer | Documentation (docs.hyperi.de), GitHub (`hyperide/hypercanvas`), Report Issue |

Design: light-first shadcn/Tailwind template — centered hero, gradient text, radial
glow blobs, uniform icon-card grid, accordion FAQ. Inter font. Static screenshots
(bulka-the-dog project), no video/GIF, no interactivity.

### 2.2 Marketplace listing (`hyperide.hypercanvas-preview`)

Live data (gallery API, fetched 2026-07-02):

- **displayName:** "HyperIDE"; **shortDescription:** "Visual editor for React components"
- **Published version:** 0.1.61 (2026-06-20); local `package.json` is 0.1.66 — the
  listing lags several releases.
- **Stats:** 511 downloads / 25 installs (MS Marketplace), 3,502 downloads (Open VSX),
  weighted rating ~4.45.
- **Category (live):** `["Visualization"]`; local `package.json` now has
  `["Other", "Visualization"]`. **Tags:** component-editor, javascript, keybindings,
  preview, react, react-native, tailwind, tamagui, visual-editor.
- **README (the listing body):** "Why HyperIDE" bullets (zero-token editing, works with
  existing codebase, deterministic, stays inside VS Code, AI optional, MCP server
  "20 tools"), features list, quick start, AI configuration (recommends "GLM via Z.ai —
  flat-rate starting from $10/mo"), settings table, commands table (11 rows — a
  documented subset of the 32 contributed commands, incl. two diagnostic-capture
  commands), requirements, license. One static hero screenshot.
  Local README additionally has a Privacy & Telemetry section (good — keep it).
- No `galleryBanner` color, no gallery images beyond the README-embedded screenshot,
  no GIF.

### 2.3 Grounded feature inventory (what we may claim)

Verified against the codebase 2026-07-02 (evidence paths abbreviated; all under
`vscode-extension/hypercanvas-preview/` unless noted):

**Solid — safe to lead with:**
- 4 panels (Preview canvas, Explorer, Inspector w/ AI chat, Logs), 32 commands, real
  keybindings for undo/redo/delete/duplicate/select-parent/go-to-code
  (`package.json` contributes, `src/extension-commands.ts`).
- Visual style editing with real code writes for **Tailwind (v4), CSS Modules, and
  Tamagui** (`lib/style-adapters/registry.ts` — the registered native writers). Inline
  `style={{}}` attributes are also editable, but as an **element-level fallback
  writer**, deliberately excluded from the project-level "writable system" gate
  (`INLINE_FALLBACK_ADAPTER_ID` exclusion) — copy must not present "inline styles" as a
  fully supported project style system.
- Element operations: drag move/**reparent** (same-file, cross-file, cross-component —
  `src/services/AstService.ts` `moveElement`), swap, duplicate, wrap, delete — all
  AST-backed with dedicated test files. Full undo/redo (`src/services/UndoRedoService.ts`).
- **Props inspection AND editing** (`client/components/RightSidebar/sections/PropsSection.tsx`,
  `ASTUpdatePropsOperation.ts`) — currently *not* marketed as a headline feature.
- Code ↔ Canvas both ways: element → source ("Go to Code"), cursor → canvas
  ("Go to Visual", `Cmd+Shift+V`), live sync toggle.
- Framework detection + dev-server management: **Vite, Next.js (App Router and Pages
  Router), Remix, CRA, Webpack, Bun** (`src/services/ProjectDetector.ts`; `ProjectType`
  in `src/types.ts` is `vite|nextjs|cra|remix|webpack|bun|unknown`). **Astro is
  detected and mapped onto the Vite pipeline** — there is no `astro` project type, so
  copy may say "works with Astro" but implementation notes must not assume a dedicated
  Astro mode. Monorepo detection (Nx, Turbo, pnpm workspaces, Lerna), React Native +
  Tamagui detection with a graceful `react-native-web` path.
  **Caveat:** `FULL_EDIT_BUNDLERS` is `['vite','cra','webpack','nextjs','bun']` —
  **Remix is excluded**, so Remix projects get preview + navigation but style editing
  is gated readonly today. Copy must scope Remix accordingly.
  **Astro caveat:** because Astro is typed as `vite`, it passes the bundler gate, but
  the AST style writers operate on JSX/TSX — React components inside an Astro project
  are the supported surface; editing `.astro` template markup is **unverified**. Before
  publishing any "works with Astro" claim, verify the actual edit path on an Astro
  fixture, or scope the claim to "React components in Astro projects".
- **MCP server with 19 tools** (insert/delete/update-styles/update-props/duplicate/wrap,
  tree/props/styles getters, color-token suggest/list, selection get/set, diagnostics,
  navigate, refresh, open-component, screenshot preview/element — `src/mcp/tools/*`).
  Setup: **Copilot's MCP registration is automatic** on activation
  (`registerCopilotMcp`); Claude Code / Codex / opencode configs are created via the
  guided `Hyper: Setup MCP` command (status-bar entry), and once present their port is
  auto-synced on every activation (`autoUpdateMcpConfigs`). There is **no
  Cursor-specific setup writer** — copy must not claim automatic setup for Cursor.
- AI chat with element context auto-injection (selected element + component go into the
  system prompt), 7 providers (claude, openai, glm, firepass, commandcode, proxy,
  opencode), bring-your-own-key.
- i18n text editing (i18next, next-intl, JSON/TS locale files —
  `shared/i18n-text/adapters/`), canvas annotations + threaded comments, design tokens
  panel, Figma-style NudgeHUD, diagnostic capture (NDJSON error log).

**Scoped — claim only with the caveat:**
- View-only style systems today (typed in `CssSystemId` but no native writer):
  **emotion, styled-components, MUI system, Chakra, Mantine, vanilla-extract, plain
  CSS, and Tailwind v3** (`lib/style-read/types.ts` union minus the registered
  writers). They render and can be inspected; **editing is not shipped yet** (active
  plan `docs/plans/2026-06-28-css-in-js-full-edit-support-plan.md`). Do not imply
  universal CSS editing anywhere, and note that "Tailwind" in editable claims means
  **Tailwind v4**. Systems not in the union at all (stitches, StyleX, Ant Design as a
  style system) must not appear in support claims.
- Remix: preview, tree, and code navigation work; **visual style writes are readonly**
  (excluded from `FULL_EDIT_BUNDLERS` — see above).
- Multi-select style writes: single-element today.

**Factual bugs in the current copy (fix regardless of the overhaul):**
1. README says MCP has "**20 tools**" — the extension's own test asserts **19**
   (`src/__tests__/HyperMcpServer.test.ts`).
2. Landing FAQ says "HyperIDE is **open source**" — the license is **Elastic 2.0**
   (source-available, not OSI open source). Legal/credibility exposure.
3. `package.json` `homepage` is `https://hyperide.ai` while the landing lives at
   `https://hyperi.de` — two domains in the wild.
4. GitHub links are inconsistent: hero + README point to `hyperide/hyper-ext`, the
   landing footer points to `hyperide/hypercanvas`.
5. Marketplace listing is 5 versions stale (0.1.61 vs 0.1.66 local).

### 2.4 What's weak (analysis)

**Landing:**
- **"with AI Superpowers" is the weakest possible headline in 2026.** Every tool claims
  AI superpowers; the phrase is a strong template-smell and says nothing. Worse, it
  buries our actual differentiator, which is the *opposite* claim: most edits need **no
  AI at all** — they are deterministic, instant, zero-token AST writes.
- The subhead is a feature list ("visual controls, code navigation, and AI context
  actions"), not a promise. It describes mechanics, not the outcome.
- Section headers are interchangeable SaaS filler ("Everything you need to build
  faster", "Built for developers who value their time") — they could sell a CRM.
- The 5 feature cards are category labels ("Visual Editing", "AI Assistant"), not
  benefits, and they undersell: props editing, reparenting across files, the MCP
  server, i18n editing, and the honest zero-token story are all absent.
- A permanently disabled "Open SaaS (soon)" button is a dead CTA in the hero.
- Everything is static. For a product whose entire pitch is "watch the real app change
  as you edit", a page of still PNGs is self-defeating.
- Design is a recognizable shadcn starter: light theme, gradient text, glow blobs,
  uniform card grid. Nothing about it says "this is a serious IDE tool".

**Marketplace:**
- The one-liner "Visual editor for React components" is generic and interchangeable
  with a dozen abandoned extensions. It's also the *search snippet* — it must carry the
  differentiator.
- The README's strongest section ("Why HyperIDE" / zero-token) is good but sits above
  the Quick Start; a marketplace visitor needs "what is it + install + first win in
  30 seconds" *first*, argument second.
- The commands table leads with internal plumbing (diagnostic capture) at the same
  visual weight as the core workflow.
- One static screenshot; no GIF of the core loop; no gallery banner; category "Other"
  is wasted real estate.
- "Recommended: GLM via Z.ai — flat-rate starting from $10/mo" reads like an ad for a
  third party inside our listing and implies the product needs a paid AI plan to be
  useful — the exact opposite of the zero-token pitch.

## 3. Audience and positioning

### 3.1 Audience-overlap thesis

Same person, different moment:

| | Landing visitor | Marketplace visitor |
|---|---|---|
| Who | React dev / tech lead, evaluates tools | Same dev, already inside VS Code/Cursor |
| Arrived from | Link, social, search, word of mouth | Marketplace search or a landing CTA click |
| Mindset | "Is this worth my attention?" — skeptical, has seen 50 AI tools | "What is this exactly, is it safe, how fast do I get value?" |
| Optimize for | Differentiated promise + visual proof + credibility | Scan-speed: one-liner → GIF → install → first win in 30 s |
| Length budget | Can scroll if hooked | 10-second scan; README read only after install intent |

Consequence: **one messaging platform, two densities.** The landing argues and proves;
the marketplace states and instructs. Nothing on the marketplace should require the
landing to make sense, and vice versa.

### 3.2 Positioning thesis

Lead with the contrarian, verifiable claim:

> **Your running app is the canvas. Edits are real code writes — deterministic,
> instant, zero AI tokens. AI is optional; when you use it (chat or any MCP agent), it
> gets the exact element you're pointing at.**

Three pillars, in priority order:

1. **Direct manipulation of the real app.** Not a design-tool clone of your UI, not a
   sandbox, not a generated preview — the actual dev server render, mapped back to
   source. Click the pixel, get the code.
2. **Deterministic, zero-token edits.** Style/layout/props/structure changes are AST
   writes: same input → same output, milliseconds, reviewable diffs, no LLM round-trip
   and no token bill for a padding tweak. This positions us *against* the 2026 default
   ("describe your change to a chat and pray") without needing to name competitors.
3. **AI with eyes and hands (optional layer).** Built-in chat that receives the
   selected element as context, plus an MCP server (19 tools) that lets agents in
   Claude Code, Copilot, or any MCP client (Cursor included, via manual MCP config)
   see the UI, select, screenshot, and apply deterministic edits. We are the visual
   grounding layer for agent workflows — a claim almost no competitor can make.

Supporting proof points: works with your existing repo (Vite / Next.js App+Pages /
Remix / CRA / Webpack / Bun / Astro, monorepos), stays local (your files, your git),
undo/redo, honest support matrix.

**Stop saying:** "AI Superpowers", "Everything you need to build faster", "like Figma"
(invites a comparison we lose on canvas polish; "Figma-style" is acceptable for micro
interactions like the NudgeHUD), "open source" (it's source-available), any implied
universal CSS-in-JS editing.

## 4. Landing page spec

### 4.1 New structure

1. Hero (interactive or video — see design direction) + install CTAs + stack strip
2. "The 10-second edit" — zero-token comparison strip
3. Feature rows (6, alternating layout, each with a real capture)
4. How it works (3 steps, scroll-synced canvas/code treatment)
5. Agent/MCP section (dedicated — this is a differentiator, not a bullet)
6. Honest support matrix (frameworks x style systems)
7. FAQ (rewritten)
8. Footer (links unified)

### 4.2 Rewritten copy

**Badge:** `Runs in VS Code · Cursor · Windsurf`

**H1 (recommended):**

> **Your running React app is the canvas.**

Alternatives for Alex to pick from:
- A. "Point at the pixel. Edit the code." (more mechanical, punchier)
- B. "Visual editing that writes real code." (safest)
- C. "Stop describing padding to a chatbot." (boldest; tone question below)

**Subhead:**

> HyperIDE renders your real app inside your editor and makes it editable. Click any
> element, adjust styles, props, and layout with visual controls — and HyperIDE writes
> the exact change back to your source files. Instant, deterministic, zero AI tokens.

**CTAs:**
- Primary (filled): `Install for VS Code`
- Secondary: `Get it for Cursor / Windsurf` (Open VSX)
- Tertiary (ghost): `GitHub`
- Add a copyable one-liner under the buttons: `ext install hyperide.hypercanvas-preview`
- **Remove** the disabled "Open SaaS (soon)" button from the hero. If we want the
  teaser, a small footer line "Cloud version coming — get notified" with an email field
  (open question 4).

**Stack strip (small, under CTAs):**
`Vite · Next.js · CRA · Webpack · Bun · Astro* · Remix*   |   Tailwind v4 · CSS Modules · Tamagui`
(*Remix carries a footnote marker — "preview + code navigation; visual style editing
on the roadmap" — because the strip sits next to the styling list and must not imply
Remix style editing. *Astro's footnote reads "React components in Astro projects"
pending the edit-path verification in §2.3. Same footnotes apply wherever these two
frameworks are listed — FAQ 1 and How-it-works step 1.)

**Section 2 — "The 10-second edit"** (replaces "Everything you need to build faster")

Two-column comparison, animated (see design):

> **The chat way:** describe the change → wait for the model → review a diff that
> touched three files → pay tokens for a padding tweak.
>
> **The HyperIDE way:** click the element → drag the spacing control → the exact
> `className` change is in your file. Milliseconds. Zero tokens. Same result every time.

Caption: *"Style, layout, and structure edits are deterministic AST operations — no
model in the loop, nothing to hallucinate."*

**Feature rows (replace the 5 icon cards):**

1. **Click the pixel, get the code.** Select any rendered element and jump to the exact
   JSX in your source — or press `Cmd+Shift+V` in code to light it up on the canvas.
   No more grepping for "which div is this".
2. **Visual styling with real writes.** Edit Tailwind classes, CSS Modules, and
   Tamagui props from the Inspector — plus inline `style` attributes where they exist —
   with design-token pickers and Figma-style nudge controls. Every change is a
   reviewable code edit, not a runtime patch.
3. **Restructure without fear.** Drag to move or reparent elements — even across files
   and components. Duplicate, wrap, swap, delete. Full undo/redo. All verified AST
   operations.
4. **Props and copy, in place.** Inspect and edit component props with type-aware
   controls. Edit UI text directly on the canvas — including the i18next / next-intl
   translation files behind it.
5. **AI that knows what you're pointing at.** The built-in chat automatically receives
   your selected element and component as context. Bring your own key — Claude, OpenAI,
   GLM, and more.
6. **Give your AI agent eyes and hands.** HyperIDE ships an MCP server with 19 tools:
   agents in Claude Code, Copilot, or any MCP client can see the component tree, select
   elements, take screenshots, and apply the same deterministic edits you do. Copilot
   registers automatically; Claude Code, Codex, and opencode get a guided
   `Hyper: Setup MCP` command; other MCP clients (Cursor included) connect via a
   standard manual MCP config entry.

(Optional 7th row if the grid needs an even count: **"Review on the canvas."** Canvas
annotations and threaded comments on elements — mark up the live UI instead of
screenshots in Slack. Ships today; currently unmarketed.)

**How it works (rewrite the 3 steps):**

1. **Open your app.** Install the extension, open your React repo, run
   `Hyper: Open Preview`, then `Hyper: Start Dev Server` (one command each; the same
   start action is available as a button in the preview panel — implementer must
   confirm the exact first-run flow and use identical wording here and in the
   marketplace quick start). HyperIDE detects your framework — Vite, Next.js (App and
   Pages Router), Remix*, CRA, Webpack, Bun, Astro* (React components in Astro
   projects), monorepos — and manages the server lifecycle for you. (*Same
   Remix/Astro footnotes as the stack strip.)
2. **Select and edit.** Click any element on the canvas. The Inspector shows its real
   styles, props, and source location. Drag, type, or pick tokens — your files update
   as you edit, HMR shows the result live.
3. **Ship the diff.** Every change is a normal edit in your working tree. Review it in
   git, commit, done. No proprietary format, no lock-in, nothing to eject from.

**Demo section header** (replaces "Built for developers who value their time"):

> **One surface for the whole loop.** Select the rendered element, inspect the actual
> JSX and styles, then act: edit visually, jump to code, or hand the exact context to AI.

**FAQ (rewritten set):**

1. *What frameworks does it support?* — Vite, Next.js (App Router and Pages Router),
   Remix, Create React App, Webpack, Bun, and Astro (React components in Astro
   projects). Monorepos (Nx, Turborepo, pnpm workspaces, Lerna) are detected
   automatically. (On Remix, visual style editing is not enabled yet — preview, tree,
   and code navigation work.)
2. *What styling can I edit?* — Tailwind v4, CSS Modules, and Tamagui are fully
   editable, plus inline `style` attributes. Plain CSS, Tailwind v3, and CSS-in-JS
   libraries (styled-components, emotion, MUI, Chakra, Mantine, vanilla-extract)
   render and can be inspected; visual editing for them is on the roadmap.
3. *Do I need an AI subscription?* — No. Visual editing is local AST manipulation —
   zero tokens, works offline. AI chat and agent tools are optional and use your own
   API key.
4. *Does my code leave my machine?* — Visual editing runs entirely locally. AI features
   send only the context needed for your explicit request to the provider you
   configure. Telemetry is anonymous, respects VS Code's global setting, and can be
   disabled.
5. *Can I use my existing project?* — Yes. Open your repo, HyperIDE starts and manages
   your project's own dev server and maps the running UI back to components and source
   locations.
6. *Does it work in Cursor / Windsurf?* — Yes, via Open VSX. Same extension, same
   features.
7. *Is it free? Is it open source?* — The source is available on GitHub under the
   Elastic License 2.0 (free to use, including commercially; you can't resell it as a
   competing service). *(Pricing wording pending — open question 2.)*

**Footer:** unify on one GitHub org/repo URL and one domain (open question 3); add
Marketplace + Open VSX links; keep Documentation and Report Issue.

### 4.3 Bolder design direction

Three directions considered:

- **A. "The landing is the product" (interactive hero).** The hero embeds a small real
  React component rendered on a canvas with HyperIDE-style selection handles and a
  mini-Inspector. Visitors drag a spacing control / change a color token and watch a
  code pane type the exact diff in real time. The strongest possible proof — the visitor
  *does the 10-second edit themselves* before installing. Cost: highest; needs a
  scripted lightweight mock (do NOT embed the real extension runtime), a reduced-motion
  and mobile fallback (autoplaying loop video).
- **B. "IDE-native dark".** Full dark-first aesthetic borrowed from the tool itself:
  VS Code-chrome window framing for every capture, syntax-highlighted diffs as design
  elements, monospace accents (JetBrains Mono) for labels/badges/stack strip, Inter for
  prose, one electric accent color, kill the gradient blobs and the uniform card grid
  in favor of alternating feature rows with large real captures. Cost: moderate — it's
  a restyle of the existing sections.
- **C. "Scroll-synced split screen".** How-it-works as a sticky two-pane scroll story:
  canvas on the left, code on the right; as the visitor scrolls, an edit plays out on
  both sides in sync (select → drag → diff appears → HMR updates). Cost: moderate;
  standard scroll-driven animation.

**Recommendation: B as the base aesthetic, C as the how-it-works treatment, A as the
hero if we can afford it — otherwise the hero is a tight 15–25 s autoplaying capture
(muted, looped, `prefers-reduced-motion` → static PNG).** Rationale: B makes the page
credible to IDE users at a glance and is cheap; C animates our core loop with
off-the-shelf techniques; A is the flagship differentiator but the only piece with real
engineering risk, so it's staged last and degradable.

Implementation guardrails (whichever direction ships):
- Hero interactive/video budget: lazy-load below-the-fold media; hero JS < ~200 KB;
  LCP stays on text, not on the video frame.
- All captures produced per the existing demo standards: real repo, dark theme, English
  captions, Explorer + Canvas + Inspector visible, AI chat hidden unless the shot is
  about chat; captured via the Playwright harness, not desktop screenshots.
- Keep light-mode support only if it costs nothing; dark-first is the brand default.

## 5. Marketplace listing spec

Everything here optimizes a 10-second scan: one-liner → GIF → install → first win.

### 5.1 Metadata (`package.json`)

- **displayName:** `HyperIDE — Visual React Editor` (search ranking weighs the display
  name; pure "HyperIDE" carries zero keywords — open question 5 if Alex prefers brand
  purity).
- **description (the search one-liner), recommended:**

  > Edit your running React app visually. Click any element, tweak styles and props —
  > HyperIDE writes the exact code change. Zero AI tokens.

  Alternatives:
  - A. "Visual editor for your real React app: select rendered elements, edit
    Tailwind/props/layout, get exact source changes — no AI round-trip."
  - B. "Click any element in your running app, edit it visually, get a precise AST
    write to your source. AI and MCP agent tools included, never required."
- **categories:** `["Visualization", "AI", "Other"]`. VS Code's own extension-manifest
  docs page omits `"AI"` from its allowed-values table, but that table is stale relative
  to the ecosystem: Microsoft's own Copilot Chat extension ships live on the Marketplace
  today with `"AI"` in its `categories` (pinned:
  https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/package.json).
  That precedent covers Marketplace *ingestion*, not necessarily local `vsce` validation —
  Copilot Chat may publish through Microsoft's own pipeline rather than a stock `vsce
  publish` — so still run `vsce package` once against this manifest before shipping and
  confirm no category warning; if it *is* rejected, fall back to
  `["Visualization", "Other"]`.
- **keywords:** add `mcp`, `nextjs`, `vite`, `remix`, `css-modules`, `inspector`,
  `live-preview`, `wysiwyg`, `devtools` to the existing set (keep all current tags).
- **galleryBanner:** `{ "color": "#0B0B0F", "theme": "dark" }` (match the dark brand).
- **homepage:** the canonical domain (open question 3).

### 5.2 README (listing body) — new structure

1. **H1 + one-liner + hero GIF.** The GIF is the core loop: click element → drag
   spacing → diff lands in the file → HMR updates. 10–15 s, < 10 MB, hosted at a stable
   raw URL.
2. **"First edit in 60 seconds"** (Quick Start promoted to the top):
   1. Install, open a React project.
   2. `Cmd+Shift+P` → `Hyper: Open Preview`, then `Hyper: Start Dev Server` (or set
      `hypercanvas.devServer.autoStart` once and forget this step) — HyperIDE detects
      the framework and manages the server. (Note: `Open Preview` alone does NOT start
      the dev server; `autoStart` defaults to `false`. Copy must reflect the two-step
      flow unless we change the default — open question 9.)
   3. Click any element on the canvas. Edit its Tailwind classes or props in the
      Inspector — the change is written to your source file immediately.
   4. `Cmd+Z` works. `git diff` shows a normal edit.
3. **What you can do** (compact, grounded bullets): visual style editing (Tailwind v4 /
   CSS Modules / Tamagui, plus inline `style` attributes); drag to move and reparent
   across files; duplicate / wrap / swap / delete; props editing; code ↔ canvas
   navigation both ways; i18n text editing; canvas annotations and threaded comments;
   component explorer; managed dev server; undo/redo.
4. **Why it's different** (condensed to 4 bullets): zero-token deterministic AST edits;
   works with your existing codebase, no migration; stays inside your editor, files and
   git untouched by any cloud; AI optional with your own key.
5. **For AI agents (MCP).** One short paragraph + the 19-tool server: Copilot
   registration is automatic; Claude Code / Codex / opencode get a guided
   `Hyper: Setup MCP` command. One GIF/screenshot of an agent driving the canvas.
6. **Supported stacks** — a small honest matrix: frameworks (Vite, Next.js App+Pages,
   CRA, Webpack, Bun, Astro, monorepos; Remix = preview + navigation, style editing on
   the roadmap) x styling (editable: Tailwind v4, CSS Modules, Tamagui, inline `style`
   attributes; view-only today: plain CSS, Tailwind v3, styled-components, emotion,
   MUI, Chakra, Mantine, vanilla-extract).
7. **Commands & settings** — keep the tables, but split "Core" (Open Preview, Go to
   Visual, Start/Stop Dev Server, Open Explorer/Inspector/AI Chat) from "Diagnostics"
   (capture commands) so plumbing doesn't dilute the workflow.
8. **AI configuration** — keep, but drop the "Recommended: GLM via Z.ai — $10/mo" line
   (reads as a third-party ad and contradicts the zero-token pitch). Replace with: "Any
   provider works; visual editing never needs one."
9. **Privacy & Telemetry** — keep the current local section as-is (it's good).
10. Requirements, Development, License — keep, but fix "20 tools" → **19** wherever it
    appears, and fix the stale requirement "VS Code 1.74 or later" → **VS Code 1.99 or
    later** (the manifest `engines` field requires `^1.99.0`; the README currently
    promises installability it can't deliver).

### 5.3 Screenshot / GIF plan (5 assets, all dark theme, English captions)

| # | Asset | Content |
|---|---|---|
| 1 | Hero GIF | The 10-second edit loop (select → drag spacing → diff → HMR) |
| 2 | PNG | Full window: Explorer + Canvas (element selected) + Inspector |
| 3 | PNG pair | Before/after of one visual edit with the resulting `git diff` visible |
| 4 | PNG | Go to Code: canvas selection + the exact JSX highlighted in the editor |
| 5 | GIF/PNG | Claude Code (or Copilot) driving the canvas via MCP |

Produced with the existing Playwright capture harness against a real demo repo
(bulka-the-dog or `templates/vite-shadcn`), per the demo-capture standards already in
use (before/after per edit, AI chat hidden except where relevant).

## 6. Before / after examples

**Marketplace one-liner:**
> Before: "Visual editor for React components"
>
> After: "Edit your running React app visually. Click any element, tweak styles and
> props — HyperIDE writes the exact code change. Zero AI tokens."

**Landing H1 + subhead:**
> Before: "Visual React Editor with AI Superpowers" / "Install HyperIDE in VS Code or
> Cursor, open your React project, and edit the real running UI with visual controls,
> code navigation, and AI context actions."
>
> After: "Your running React app is the canvas." / "HyperIDE renders your real app
> inside your editor and makes it editable. Click any element, adjust styles, props,
> and layout with visual controls — and HyperIDE writes the exact change back to your
> source files. Instant, deterministic, zero AI tokens."

**Feature card:**
> Before: "Visual Editing — Edit React components with a Figma-like interface. Select
> elements, modify styles, and see changes instantly."
>
> After: "Visual styling with real writes — Edit Tailwind classes, CSS Modules, and
> Tamagui props from the Inspector. Every change is a reviewable code edit, not a
> runtime patch."

**Section header:**
> Before: "Everything you need to build faster"
>
> After: "The 10-second edit" (with the chat-way vs HyperIDE-way comparison)

**FAQ honesty fix:**
> Before: "Is HyperIDE free to use? — HyperIDE is open source. Check the GitHub
> repository for license details…"
>
> After: "Is it free? Is it open source? — The source is available on GitHub under the
> Elastic License 2.0 (free to use, including commercially; you can't resell it as a
> competing service)."

## 7. Hygiene fixes (ship immediately, independent of the overhaul)

1. README + any other copy: "20 tools" → **19 tools**.
2. Landing FAQ: remove the "open source" claim → "source-available, Elastic License 2.0".
3. Pick the canonical domain; align `package.json` `homepage`, footer, docs links.
4. Unify GitHub links (`hyperide/hyper-ext` vs `hyperide/hypercanvas`) to the repo we
   actually want the public on.
5. Publish the current extension version so the listing stops lagging (0.1.61 → 0.1.66+).
6. Add `galleryBanner` and the extra keywords (zero-risk metadata).
7. README Requirements: "VS Code 1.74 or later" → "VS Code 1.99 or later" (matches
   `engines.vscode: ^1.99.0`).

## 8. Open questions for Alex

1. **Tone ceiling.** How contrarian can the landing be about AI-codegen tools? Options:
   (a) never name competitors, frame as "the chat way" (recommended — punchy without
   picking fights), (b) name categories ("v0-style generators"), (c) name products.
2. **Pricing story.** The FAQ must answer "is it free?" — what is the actual plan
   (free while in beta? free extension + paid SaaS later?). Current copy dodges and the
   dodge reads evasive.
3. **Canonical domain + repo.** `hyperi.de` or `hyperide.ai`? `hyper-ext` or
   `hypercanvas`? Everything else in section 7 hangs off this.
4. **SaaS teaser.** Drop "Open SaaS (soon)" entirely, or replace with an email-capture
   waitlist in the footer?
5. **Extension displayName.** `HyperIDE — Visual React Editor` (better search) vs
   `HyperIDE` (brand purity)?
6. **Hero budget.** Approve the interactive hero (direction A) as a staged follow-up,
   or lock the hero to a looped capture?
7. **React Native / Tamagui prominence.** Detection + degrade path ship; is the RN
   story demo-ready enough to market beyond a tag, or keep it quiet for now?
8. **Numbers policy.** Recommend showing NO install/download counts anywhere until they
   exceed ~5k (511 on MS Marketplace reads as anti-proof). Agreed?
9. **First-win friction.** `hypercanvas.devServer.autoStart` defaults to `false`, so
   the honest quick start is two commands, not one. Flip the default (product change,
   with a safe prompt on first run), or keep the two-step copy?

## 9. Rollout order

1. **Phase 0 — hygiene** (section 7): tiny PRs, no design work.
2. **Phase 1 — marketplace**: README restructure + metadata + asset set (section 5).
   Cheapest surface, highest intent traffic, unblocks the next publish.
3. **Phase 2 — landing copy**: swap copy into the existing layout (section 4.2) so the
   message improves before the redesign lands.
4. **Phase 3 — landing design**: direction B restyle + C scroll story; A interactive
   hero as a separate follow-up if approved.

Each phase is a separate PR against this spec; all claims must trace to section 2.3's
inventory (no new claims without code evidence).

**Publish-time verification checklist (applies to every phase):**
- **Counters are re-verified at publish time, never trusted from this spec:** MCP tool
  count (19 today — re-run the `HyperMcpServer` test), contributed command count
  (32 today), published version numbers. Hardcoded counts are exactly how "20 tools"
  happened; prefer wording that avoids counts where the number adds nothing.
- **Telemetry claims** ("anonymous, respects VS Code's global setting, can be
  disabled") — re-verify against the actual telemetry gate before each publish; a
  false privacy guarantee is the same failure class as the "open source" claim.
- **License wording** — the Elastic 2.0 summary in the FAQ is a paraphrase of a legal
  text; run it past legal review (or copy the license's own summary verbatim) before
  it ships.
- Astro edit path, exact first-run dev-server flow, and `vsce` acceptance of the `"AI"`
  category (Marketplace precedent looks solid, but the local `vsce package` check hasn't
  actually been run yet — see section 5.1) are marked "verify before shipping" in their
  sections — do not skip them.
