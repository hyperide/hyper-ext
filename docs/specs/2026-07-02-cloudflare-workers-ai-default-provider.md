# Spec: Cloudflare Workers AI as a default LLM provider for the HyperIDE AI agent

- Status: Policy decision FINAL (§9a, Alex tg#5903/tg#5904, 2026-07-03). Implementation plan
  NOT yet ready to build as written — a 2026-08-13 technical review found real gaps (mostly
  credential/auth security) in §7's checklist; see §9b before starting HYP-881.
- Audience: Alex (CTO) and whoever picks up the integration
- Date: 2026-07-02
- Request: Alex tg#5751 — research using Cloudflare AI as the default provider in the
  HyperIDE AI agent; we hold a $5,000 Cloudflare credit; the ask is "top models".
- Reference catalog: https://developers.cloudflare.com/workers-ai/models/

> All external facts below were fetched live on 2026-07-02 (my training cutoff predates
> several of these models — GLM-5.2, Kimi K2.6/K2.7, gpt-oss, Nemotron 3). Sources are
> inlined per section and collected in §11. Code facts are grounded in the actual repo.

---

## 1. TL;DR / recommendation

The framing "swap the default from Claude to Cloudflare" is partly wrong once you read the
code, and that makes the answer better than expected:

- **The VS Code extension agent already defaults to an open model** (`glm` = Z.ai GLM-4.7,
  called directly from the extension host with the user's own key). It is NOT on Claude today.
- **Only the SaaS server agent defaults to Claude** (`claude-sonnet-4-20250514`).

So the recommendation splits cleanly:

1. **Extension default → `@cf/zai-org/glm-5.2` on Cloudflare Workers AI: YES, recommend.**
   This is an *upgrade* (GLM-4.7-flash → GLM-5.2 flagship, +huge on coding/agentic benchmarks)
   plus a provider consolidation onto Cloudflare AI Gateway. It replaces a weaker open model
   with a stronger one — not a Claude downgrade. The $5k credit funds it.
2. **Server default (Claude Sonnet 4) → GLM-5.2: NOT a blind flag-day swap.** Ship GLM-5.2 as a
   selectable model and make it the default for a **free/pilot tier only**, with **Claude
   auto-fallback via AI Gateway**. Keep Claude the default for paid/pro until real
   task-success metrics justify a flip.

Why not "GLM-5.2 everywhere, today": GLM-5.2 is at near-parity with frontier on *tool-call
accuracy* (BFCL) and *agentic shell tasks* (Terminal-Bench 81.0), which clears the historical
blocker for open models. But it is still a notch below *current-frontier* Claude on end-to-end
real-repo fixes (SWE-bench Verified), first-token latency is ~6.5s vs Claude's sub-second,
there is a 300 req/min default rate limit, and after the credit burns Cloudflare is a pricier
GLM host than dedicated vendors. Route through **AI Gateway** so the default is one config line
and Claude stays one fallback away.

---

## 2. Live Cloudflare Workers AI model shortlist (fetched 2026-07-02)

Non-deprecated **function-calling** text-generation models — function calling ("FC") is the one
capability the HyperIDE agent hard-depends on. Pricing is $/1M tokens; Workers AI denominates in
"neurons" at $0.011 / 1,000 neurons. Slugs and contexts are copied from the individual model
pages + pricing table (not guessed).

| Model (slug) | FC | Reason | Context | $/1M in | $/1M out | cached in | Fit |
|---|---|---|---|---|---|---|---|
| `@cf/zai-org/glm-5.2` | ✓ | ✓ | 262,144 | $1.400 | $4.400 | $0.260 | **Primary** — flagship agentic coding, best open-weight coder. MoE ~753B/40B, rel. 2026-06-13. |
| `@cf/openai/gpt-oss-120b` | ✓ | ✓ | 128,000 | $0.350 | $0.750 | — | **Cheap frontier-ish** alt / fallback. ~62% SWE-bench Verified. |
| `@cf/moonshotai/kimi-k2.6` | ✓ | ✓ | 262,144 | $0.950 | $4.000 | $0.160 | Frontier-scale alt; 262K ctx, multi-turn tools. |
| `@cf/moonshotai/kimi-k2.7-code` | ✓ | ✓ | 262,144 | $0.950 | $4.000 | $0.190 | Code-tuned Kimi variant. |
| `@cf/nvidia/nemotron-3-120b-a12b` | ✓ | ✓ | 256,000 | $0.500 | $1.500 | — | 120B/12B MoE, multi-agent optimized. |
| `@cf/zai-org/glm-4.7-flash` | ✓ | ✓ | 131,072 | $0.060 | $0.400 | — | Cheap agentic tier (near what the extension uses now). |
| `@cf/google/gemma-4-26b-a4b-it` | ✓ | ✓ | 256,000 | $0.100 | $0.300 | — | Cheap, large ctx, FC. |
| `@cf/openai/gpt-oss-20b` | ✓ | ✓ | 128,000 | $0.200 | $0.300 | — | Fast/cheap micro-action tier. |
| `@cf/ibm-granite/granite-4.0-h-micro` | ✓ | — | 131,000 | $0.017 | $0.112 | — | Extremely cheap; FC-strong per IBM. |
| `@cf/qwen/qwen3-30b-a3b-fp8` | ✓ | ✓ | **32,768** | $0.051 | $0.335 | — | Cheap MoE, but small ctx — not for big code context. |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | ✓ | — | **24,000** | $0.293 | $2.253 | — | Well-understood tool calling, but small ctx. |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | ✓ | — | 131,000 | $0.270 | $0.850 | — | MoE, vision, batch. |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | ✓ | — | 128,000 | $0.351 | $0.555 | — | Cheap FC. |

Notably **NOT agent-viable** (no function calling despite being "coding"/"reasoning" models):
`@cf/qwen/qwen2.5-coder-32b-instruct`, `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`,
`@cf/qwen/qwq-32b`. Do not pick these for the tool loop.

Recommended: **primary `@cf/zai-org/glm-5.2`**, **fallback/cheap-tier `@cf/openai/gpt-oss-120b`**
(or Claude via gateway), **fast micro-action `@cf/openai/gpt-oss-20b`**.

Sources: https://developers.cloudflare.com/workers-ai/models/ ;
https://developers.cloudflare.com/workers-ai/models/glm-5.2/ ;
https://developers.cloudflare.com/workers-ai/platform/pricing/ (page: "Last updated Jun 16, 2026")

---

## 3. Quality / reliability — the honest assessment

An agentic coding product lives or dies on tool-call reliability and edit correctness, not chat
vibes. Data fetched 2026-07-02.

### 3.1 Benchmarks

- **SWE-bench Verified (real GitHub fixes)** — frontier is Claude: Mythos 5 95.5%, Fable 5
  95.0%, Opus 4.8 88.6% (July 2026 leaderboard). GLM-5.2 lands "in the same tier as Claude
  **Opus 4**" (an *older* Claude generation) on SWE-bench Verified; gpt-oss-120b ~62%.
  → On end-to-end repo fixes, **current-frontier Claude is clearly ahead of GLM-5.2**.
- **SWE-bench Pro** — GLM-5.2 62.1, beating GPT-5.5 (58.6) and its predecessor GLM-5.1 (58.4).
  VentureBeat: "beats GPT-5.5 on multiple long-horizon coding benchmarks for 1/6th the cost."
- **Terminal-Bench 2.1 (agent in a real shell: install deps, run cmds, recover from errors)** —
  GLM-5.2 81.0, *within a few points of Claude Opus 4.8*. The most product-relevant agentic
  number, and it is genuinely strong.
- **BFCL v3 (Berkeley Function Calling Leaderboard, tool-call AST accuracy)** — GLM 4.5 76.7%,
  Claude Opus 4.7 76.6%, Gemini 3.1 Flash Lite 76.5%. Top open models are at **parity** with
  Claude on raw function-calling accuracy.

### 3.2 What this means for HyperIDE

- **Tool calling: viable.** BFCL parity + near-frontier Terminal-Bench means GLM-5.2 can drive
  HyperIDE's tool loop (read/edit files, AST/context actions) reliably. This was the historical
  blocker for open models and it is now largely cleared for GLM-5.2 specifically; real-world
  reports call its tool calling "clean and consistent" with reliable structured/JSON output.
- **Edit correctness on hard tasks: a step down.** On end-to-end SWE-bench Verified,
  current-frontier Claude is materially higher. Expect **more retries / wrong-edit attempts on
  complex multi-file refactors**. Simple scoped edits: users likely won't notice. Gnarly
  cross-file refactors: they will. (Note: the extension is already on GLM-4.7, so for extension
  users GLM-5.2 is a strict *improvement*, not a regression.)
- **Long-context drift.** GLM-5.2 instruction fidelity degrades above ~64K tokens despite the
  262K window. Keep packed context lean.
- **Planning ceiling.** GLM-5.2 is weaker at *novel open-ended* planning than at executing a
  given plan. Agents that hand it a clear plan do better than ones asking it to invent one.

### 3.3 Latency & capacity

- **TTFT ~6.5s** for GLM-5.2 across independent providers (Artificial Analysis; Cloudflare not
  in that benchmark set). Claude's first token is typically sub-second. For an interactive
  "AI action in the canvas" this is a **noticeable UX regression** — mitigate with streaming +
  optimistic UI; keep a fast small model for latency-sensitive micro-actions.
- **Rate limit: 300 req/min** default for text generation (per-model varies), account-shared —
  a real ceiling at product scale. Plan AI Gateway rate limiting; request higher limits from
  Cloudflare if needed.
- **Large-model capacity:** Cloudflare runs large models on a custom "Infire" engine with an
  **async/durable queue** fallback ("executes durably... typically within 5 minutes") when
  synchronous capacity is tight. 5-minute latency is unacceptable interactively → use the
  synchronous streaming path and treat capacity errors as a fallback trigger, never the async
  queue for interactive calls.

Sources: https://artificialanalysis.ai/models/glm-5-2/providers ;
https://developers.cloudflare.com/workers-ai/platform/limits/ ;
https://blog.cloudflare.com/workers-ai-large-models/

---

## 4. Cost analysis vs the $5k credit

- **Neuron economics:** $0.011 / 1,000 neurons; free tier 10,000 neurons/day (~$0.11/day —
  negligible for a product, and no overage on the Workers Free plan, so a Paid plan is required).
- **GLM-5.2:** $1.400 in / $4.400 out per 1M, and crucially **$0.260/M cached input** (prefix
  caching). The agent tool loop reuses a big prefix (system prompt + tool defs + accumulated
  context) across rounds, so cached input matters a lot.
- **Prompt/prefix caching IS supported** on Workers AI, automatic via `x-session-affinity`,
  surfaced in the usage object. HyperIDE does **not** use prompt caching today (see §6), so it
  gets this benefit essentially for free on Cloudflare. Caveat: prefix caching gated on session
  affinity is **less deterministic** than Anthropic's explicit `cache_control`; don't assume a
  fixed hit rate.

### 4.1 Rough per-action cost (agentic coding turn)

Assume one user "AI action" = a tool loop of several LLM calls, cumulatively ~200K input tokens
(system + tools + code context, largely a reused prefix) + ~25K output tokens:

- **GLM-5.2, no caching:** 200K × $1.40/M + 25K × $4.40/M ≈ **$0.28 + $0.11 = ~$0.39/action**.
- **GLM-5.2, with effective prefix caching** (say 70% of input hits cache): 60K × $1.40/M +
  140K × $0.26/M + 25K × $4.40/M ≈ $0.084 + $0.036 + $0.11 ≈ **~$0.23/action**.
- **Server baseline, Claude Sonnet 4 (~$3/$15, illustrative — confirm real bill):** 200K × $3/M
  + 25K × $15/M ≈ **~$0.98/action** before caching. → GLM-5.2 is **~2.5-4x cheaper per action**.
- **Extension baseline, Cloudflare `glm-4.7-flash` pricing as a stand-in ($0.06/$0.40) for the
  extension's actual Z.ai `glm-4.7` price (different, unstated — the CF number is a proxy, not
  the real current cost):** 200K × $0.06/M + 25K × $0.40/M ≈ $0.012 + $0.010 = **~$0.022/action**
  (corrected — an earlier draft of this section had the input term off by 10x, at ~$0.13/action).
  So GLM-5.2 is **~10.5x pricier at best (with caching, $0.23/$0.022) to ~17.7x at worst
  (uncached, $0.39/$0.022)** than the extension's current open model, not "2-3x" — a much
  bigger quality-for-cost trade than originally stated, cushioned by the credit. Worth stating
  plainly: the extension upgrade is not free even vs its current GLM default, and the gap is an
  order of magnitude larger than this section first claimed.

### 4.2 $5k runway

At ~$0.23-0.39/action (GLM-5.2): **$5,000 ≈ 13,000-22,000 agent actions**. At ~20-40 actions per
active user per month → **roughly a few hundred user-months** — a few hundred active users for a
month, or a smaller beta cohort for several months. **The credit is a pilot budget, not a
permanent subsidy.** After it burns, Cloudflare's GLM-5.2 (~$2 blended) is ~2.5x pricier than the
cheapest dedicated GLM hosts (~$0.72-0.79 blended at GMI/Blackbox per Artificial Analysis), but
you get AI Gateway, edge proximity, unified fallback, and one bill in return.

- **Batch API: no documented discount** (confirmed on the pricing + batch-api pages). Batch is a
  capability on some models but billed at standard rates — it is not a cost lever here.
- **Action:** instrument real token usage per HyperIDE action on the current providers FIRST,
  then this runway math becomes exact instead of illustrative.

---

## 5. API surface (what integration actually gets)

- **Native binding:** `env.AI.run("@cf/zai-org/glm-5.2", {...})` — only reachable from a
  Cloudflare Worker (relevant for the server path, not the extension host).
- **REST / OpenAI-compatible:** `POST …/accounts/{id}/ai/v1/chat/completions` — "use the OpenAI
  SDK by changing the base URL and model name," auth via `Authorization: Bearer <token>`. This is
  the path HyperIDE will use (see §6 — the code already speaks the OpenAI Chat Completions shape).
- **Streaming:** supported (SSE / `stream: true`). **Streaming + tool calls together** is the one
  thing to smoke-test (see §7) — it is the whole agent's hard requirement.
- **Tool calling:** native `tools` param, plus a `@cloudflare/ai-utils` "embedded" helper that
  automates the tool loop.
- **AI Gateway (the important piece):** one universal endpoint fronting Workers AI **+ Anthropic +
  OpenAI + Google + Replicate** ("70+ models, 12+ providers"). Gives **request retry + cross-model
  fallback**, caching, rate limiting, cost/token analytics, logging, and **streaming buffer +
  reconnect without paying twice** if an agent is interrupted mid-inference. Cloudflare's own
  pitch: "switching from a Cloudflare-hosted model to one from OpenAI, Anthropic, or any other
  provider is a one-line change."

Sources: https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/ ;
https://developers.cloudflare.com/workers-ai/features/function-calling/ ;
https://developers.cloudflare.com/ai-gateway/ ; https://blog.cloudflare.com/ai-platform/

---

## 6. Current HyperIDE agent architecture (grounded in the repo)

The agent is **multi-provider by design**, built around a two-wire-protocol abstraction
(`anthropic` = Anthropic Messages API, `openai` = OpenAI Chat Completions). Only
`@anthropic-ai/sdk` is a hard SDK dependency (server + lib); every other provider is reached via
raw `fetch()`. **There is zero Cloudflare Workers AI usage today.** There are **two independent
agent implementations**:

- **Extension agent (in-product, standalone).** `AIBridge` calls the LLM **directly from the VS
  Code extension host** with the **user's own API key** — no HyperIDE backend in the loop
  (BYOK). This is the "AI context actions" agent that edits React in Hyper Canvas.
  - `vscode-extension/hypercanvas-preview/src/bridges/AIBridge.ts` — `handleChat()` resolves
    config, picks a `StreamProvider`, drives `runChat()`, executes tools locally via Node
    `fs`/`child_process`.
  - Default provider is **`glm`** (`vscode-extension/hypercanvas-preview/package.json`
    ~L394-439: `hypercanvas.ai.provider` `"default": "glm"`). Key in VS Code secrets.
- **SaaS server agent (backend).** `server/services/ai-agent.ts` class `AIAgent.chat()` — three
  sub-paths: Anthropic SDK (default), raw OpenAI-tools `fetch`, and OpenCode. `MAX_TOOL_ROUNDS =
  25`. Config resolved per workspace from the DB (`server/services/ai-config-resolver.ts`).
  Default provider = **Claude** (`claude-sonnet-4-20250514`).

**Provider defaults / model IDs** (single source of truth) —
`shared/ai-provider-defaults.ts`:
`type AIProvider = 'claude' | 'openai' | 'glm' | 'firepass' | 'commandcode' | 'proxy' |
'opencode'`. e.g. `claude` → `claude-sonnet-4-20250514` (anthropic), `glm` → `glm-4.7` @
`https://api.z.ai/api/coding/paas/v4` (openai), `firepass` → Fireworks Kimi, `openai` → `gpt-4o`.

**Abstraction layer — YES, clean, and this is the insertion point:**
- `shared/ai-agent-core.ts` — the `StreamProvider` interface
  (`createStream(): AsyncIterable<RawStreamEvent>`) with `FetchAnthropicProvider` and
  **`FetchOpenAIProvider`** (translates OpenAI SSE + function calling into the Anthropic-shaped
  event stream that the shared `runChat()` tool loop consumes). A Workers-AI provider is just a
  new `AI_PROVIDER_DEFAULTS` entry on the existing `openai` path — **likely no new StreamProvider
  class needed** (Bearer auth already handled).
- `lib/ai-client/config.ts` — `resolveAIConfig()` normalizes any provider to
  `{apiKey, model, baseURL, provider: 'anthropic'|'openai'}` (the routing brain).
- `lib/ai-client/client.ts` — `callAI()`/`callAIStream()` unified non-agentic calls.
- `shared/ai-agent-tools.ts` — SDK-neutral tool defs `{name, description, input_schema}` +
  `toOpenAITools()` wire translation.
- UI/copy: `shared/ai-provider-info.ts` (labels/pricing), `client/components/AISettings.tsx`
  (SaaS settings), extension settings enum in `package.json`.

**Integration surface facts that make the change bigger than "one defaults entry"** (do not
under-scope these — they are the difference between "compiles" and "actually works"):
- `resolveAIConfig()` (`lib/ai-client/config.ts`) is a **closed `switch`** on provider; without
  an explicit `cloudflare` case, SaaS and non-chat extension callers resolve to `null` (and
  `AIBridge` may fall back inconsistently). Needs a case + unit coverage in
  `lib/ai-client/__tests__/config.test.ts`.
- The SaaS `ai_config.provider` column is backed by a **Postgres enum** (`aiProviderEnum`,
  `server/database/schema/projects.ts`). Adding `cloudflare` requires a **Drizzle migration**
  (+ schema snapshots), not just a TS union edit — otherwise saving the provider fails at the DB.
- The extension stores **one provider-agnostic API-key secret** (`AIBridge.ts` `_getApiKey()`;
  the configure command in `src/extension-commands.ts` writes the same key for every provider),
  and the **key picker/wizard is hardcoded** (`src/extension-commands.ts`), not derived from
  `AI_PROVIDER_DEFAULTS`. So (a) the picker won't offer Cloudflare unless updated / made
  data-driven, and (b) flipping the default reuses whatever single key is stored (see §8).

**Features the agent relies on:**
- **Tool/function calling — central.** Full agentic `tool_use` loop, both protocols. Tools:
  `read_file, edit_file, write_file, grep_search, glob_search, list_directory, tree,
  get_diagnostics, git_command, bash_exec, ask_user` (extension) + more server-side.
- **Streaming (SSE) — always, hard requirement** (real-time token + tool-call display).
- **JSON mode / structured output — NO** (structured output comes from tool-call args).
- **Prompt caching — NO** (zero `cache_control`/`ephemeral` in any path). → Nothing to port;
  Cloudflare prefix caching is a free upside.
- **Large context** — relied on implicitly (whole-file reads, AST context, tool-result
  accumulation). Output `max_tokens` 16384 (server) / 8192 (extension).
- **Vision — NO** (image refs are asset upload/serving, not LLM inputs).

---

## 7. Migration / integration plan

Effort is **low** because the abstraction exists and Workers AI is OpenAI-compatible.

### 7.1 Wire in Cloudflare as a provider (small-to-medium — full checklist)
1. Add a `'cloudflare'` entry to `AI_PROVIDER_DEFAULTS` in `shared/ai-provider-defaults.ts`
   (model `@cf/zai-org/glm-5.2`, `protocol: 'openai'`). **Wrinkle:** the base URL is
   **account-scoped** (`…/accounts/{account_id}/ai/v1`), which doesn't fit the static-default
   pattern — reuse the existing custom-baseURL / `backend` mechanism
   (`hypercanvas.ai.baseURL`) or template the account id in.
2. Add the **explicit `cloudflare` case in the closed `switch` of `resolveAIConfig()`**
   (`lib/ai-client/config.ts`) so it lands on the `openai` path; verify Bearer auth header
   shape; **add coverage in `lib/ai-client/__tests__/config.test.ts`** (without the case,
   callers resolve to `null`).
3. **SaaS DB migration:** add `cloudflare` to the Postgres `aiProviderEnum`
   (`server/database/schema/projects.ts`) via a **Drizzle migration + schema snapshots** —
   required or saving the provider fails at the DB layer.
4. UI/config wiring: enum entry in extension `package.json` (`hypercanvas.ai.provider`), SaaS
   `client/components/AISettings.tsx`, label/pricing copy in `shared/ai-provider-info.ts`, and
   **the hardcoded extension key picker/wizard in `src/extension-commands.ts`** (add Cloudflare
   or make it data-driven from `AI_PROVIDER_DEFAULTS`) — otherwise the wizard never offers it.
5. **Smoke-test streaming + tool calling end-to-end against BOTH tool loops** with the real
   HyperIDE tool set via the Workers AI OpenAI-compat endpoint: the shared `runChat()` /
   `FetchOpenAIProvider` path (extension) **and** the separate server OpenAI tool loop in
   `server/services/ai-agent.ts`. This is the single hard requirement — tool-call *formatting*
   over SSE is where open models most often break the loop. Gate everything on this passing.

### 7.2 Route through AI Gateway (recommended)
Point the base URL at an **AI Gateway** endpoint instead of Workers AI directly. This buys:
GLM-5.2 → Claude/gpt-oss **fallback** on error / tool-call-format failure / 429 / capacity,
response caching, rate limiting, and cost analytics in one place — and keeps Claude one config
line away. Because AI Gateway is also OpenAI-compatible, this is still the `openai` path.

### 7.3 Who pays — BYOK vs credit-funded (decision needed)
Today the extension is BYOK (user's key, **direct** bearer-auth fetch from the extension host).
To spend the **$5k Cloudflare credit**, usage must run through a **HyperIDE-owned Cloudflare
account / AI Gateway**. **Do NOT ship a bundled/shared Cloudflare token in the extension** — a
client-side token is trivially extractable and abusable. The only safe design is a
**token-broker / proxy** endpoint owned by HyperIDE that authenticates the user, enforces
per-user quotas, and holds the Cloudflare credentials server-side. This is a product/billing
change, not just a provider add. (The server path already holds keys server-side, so it can adopt
the credit directly.)

**Key-storage migration (blocking for the extension default flip):** the extension keeps a single
provider-agnostic secret. If we flip the default to `cloudflare`, an existing user who only saved
a GLM (or other) key would have that key sent to Cloudflare — auth failures at best, cross-provider
key confusion at worst. Before flipping: move to **provider-scoped secrets** (or a re-prompt /
migration that clears/asks for a Cloudflare key), so the default change never reuses a foreign key.

### 7.4 Rollout

> **Superseded by §9a — do not implement as written.** This subsection is the original
> tiered proposal (free tier on GLM-5.2, paid/pro kept on Claude). §9a's FINAL ruling removes
> the Claude default and the paid/pro tier split entirely: **both surfaces go to Cloudflare,
> for all tiers, with no Claude default anywhere.** Kept below only as the historical
> reasoning; follow §9a, not these bullets.

- ~~**Extension:** flip the default from `glm` (GLM-4.7 @ Z.ai) to `cloudflare` (GLM-5.2) — an
  upgrade. Keep BYOK for pro users; use the credit-funded gateway for a free tier.~~
- ~~**Server:** add GLM-5.2 as selectable; default it for the **free/pilot tier** with Claude
  auto-fallback; keep Claude default for paid/pro.~~
- **Gate any global default flip** on real metrics (§8) — not benchmarks. (This one bullet
  still stands: §9a decided the *default*, not the metrics-gating discipline for any *future*
  re-evaluation of that default.)

---

## 8. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Edit quality below frontier Claude on hard multi-file tasks (server path) | High | Keep Claude as gateway fallback + default for pro tier; pilot GLM-5.2 on free tier; gate global flip on real success metrics. |
| Tool-call formatting breaks the agent loop over SSE | High | End-to-end streaming+tools smoke test on the real tool set for BOTH loops (`shared/runChat` + `server/services/ai-agent.ts`) before rollout. **AI Gateway fallback only covers provider/transport errors (429/5xx/timeout), NOT post-stream tool-call parse failures** — those surface inside HyperIDE's own parser (e.g. `unknown_tool` in `shared/ai-agent-core.ts`). So add **app-level retry/fallback** on malformed tool calls in both loops; consider `@cloudflare/ai-utils`. |
| Flipping the extension default reuses the single stored key against Cloudflare | High | Provider-scoped secrets or a re-prompt/migration before the default flip (see §7.3) — never send a saved GLM/other key to Cloudflare. |
| Bundled/shared Cloudflare token in the client extension is extractable/abusable | High | Never ship a client token; use a HyperIDE-owned token-broker/proxy with per-user auth + quotas (§7.3). |
| SaaS provider is a Postgres enum — TS-only add fails at the DB | Medium | Drizzle migration for `aiProviderEnum` + snapshots (§7.1). |
| `resolveAIConfig()` closed switch resolves unknown providers to null | Medium | Add explicit `cloudflare` case + `config.test.ts` coverage (§7.1). |
| TTFT ~6.5s hurts interactive feel | Medium | Streaming + optimistic UI; fast small model (gpt-oss-20b) for latency-sensitive micro-actions. |
| 300 req/min limit / large-model async 5-min queue | Medium | AI Gateway rate-limit + retry/fallback; request higher limits; never use the async path interactively. |
| $5k is a pilot budget, not permanent; CF ~2.5x pricier than dedicated GLM hosts post-credit | Medium | Treat as a pilot; if GLM-5.2 wins, keep the gateway but consider a dedicated GLM backend behind it. |
| Prefix caching less deterministic than Claude `cache_control` | Medium | Prompt prefix-first; measure cached-token ratio in usage; recompute runway with real hit rate. |
| Account-scoped base URL doesn't fit the static default pattern | Low | Use the existing custom-baseURL / backend mechanism. |
| BYOK → credit-funded requires a HyperIDE-owned token-broker/proxy (not a bundled token) | Med (product) | Decide free-tier billing model; server path can adopt the credit immediately. |
| Long-context (>64K) instruction drift | Low/Med | Keep packed context lean; don't rely on the full 262K window. |
| Model provenance / data residency (GLM-5.2 = Chinese-origin open weights) | Med (enterprise) | Weights run on **Cloudflare** GPUs — customer code is NOT sent to Z.ai. Still, confirm acceptable for enterprise; document it; let enterprise pin Claude. (Note the extension already ships GLM-4.7 from Z.ai *direct* today, so this bar is arguably already crossed — Cloudflare hosting is actually *stricter*.) |

---

## 9. Open questions for Alex

1. **Scope:** default swap for the **extension** (already on GLM — easy upgrade), the **server**
   (Claude today — real decision), or both?
2. **Billing model:** is GLM-5.2 meant as the **free-tier default** funded by the credit (needs a
   HyperIDE-owned Cloudflare gateway; changes BYOK), or purely a new selectable option users pay
   for with their own Cloudflare key?
3. **Baseline:** current server monthly Claude bill + real tokens-per-action? (Turns §4's
   illustrative math into exact savings.)
4. **Quality bar:** is a ~5-10% lower edit-success rate on hard tasks acceptable for the target
   cohort in exchange for ~3x lower cost?
5. **Data residency:** is a Chinese-origin open model (hosted on Cloudflare, code not sent to
   Z.ai) acceptable for all tiers, or must enterprise pin Claude?
6. **Context needs:** does HyperIDE routinely pack >64K tokens of code context? If so GLM-5.2's
   *effective* window is a constraint even at 262K.

---

## 9a. FINAL decision (Alex, tg#5903 + tg#5904, 2026-07-03)

§9 above is left as the historical record of what was asked. This section closes it — every
open question below has a binding answer, not a recommendation. Sourced from two Telegram
messages, tg#5903 and tg#5904, and from investigation done while writing this section.

**Alex, verbatim (tg#5903):** "Модель и код агента должен быть унифицированным. И нет у нас
Claude по умолчанию насколько я знаю и не должно быть. По умолчанию мы советуем glm через
z.ai. Теперь же по умолчанию пусть и saas и ext ходят через наш cf с glm5.2 и возможностью
переключаться на kimi и nemotron."

- **Scope (§9 Q1) — BOTH surfaces.** SaaS server and VS Code extension both switch to
  Cloudflare Workers AI. There is no Claude default today (the extension never had one) and
  there must not be one going forward on either surface — the server's existing
  `claude-sonnet-4-20250514` default is retired, not just supplemented.

- **Billing model (§9 Q2) — free for the user, right now.** The default tier is funded
  entirely by the $5k Cloudflare credit (§4). No BYOK requirement to use the new default
  (tg#5904, point 1). BYOK remains available as an opt-in for the existing providers; it is
  not the default and is not being removed.

- **Unification (new, beyond §9's original questions).** One shared backend module makes the
  actual Cloudflare Workers AI call. Both the SaaS UI and the VS Code extension are HTTP
  clients of that one module/endpoint — they do not each speak to Cloudflare independently.
  This supersedes §7.1's "just add a provider entry" framing: adding `cloudflare` to
  `AI_PROVIDER_DEFAULTS` is necessary but not sufficient, because of the next point.

- **Security constraint (new, tg#5904 points 2+3) — changes the integration shape §6/§7
  assumed.** The Cloudflare API token must never reach client code — not the extension
  bundle, not any config sent to the client. §7.3 already flagged this risk ("Never ship a
  client token... use a token-broker/proxy"); Alex's ruling makes it a hard architectural
  rule, not a risk-mitigation suggestion. Concretely: **the VS Code extension must NOT call
  Cloudflare directly**, unlike its current BYOK GLM/Z.ai path (§6). It must call HyperIDE's
  own backend (the SaaS server, running in k3s); the backend holds the Cloudflare credentials
  server-side and proxies the call. The extension's "BYOK, direct-from-extension-host" model
  (§6) does not apply to the `cloudflare` provider — it is the first managed,
  backend-proxied provider in the catalog, not a peer of `glm`/`openai`/`firepass` etc.

- **Model selection (§9 Q4/Q6, superseded by the decision rather than answered
  individually).** Default `@cf/zai-org/glm-5.2`, user-switchable within the same provider to
  `@cf/moonshotai/kimi-k2.7-code` (Kimi K2) and `@cf/nvidia/nemotron-3-120b-a12b` (Nemotron
  3). Slugs and pricing reconfirmed live from `developers.cloudflare.com/workers-ai/models/`
  on 2026-07-03:

  | Model (slug) | Context | $/1M in | $/1M out | cached in |
  |---|---|---|---|---|
  | `@cf/zai-org/glm-5.2` | 262,144 | $1.40 | $4.40 | $0.26 |
  | `@cf/moonshotai/kimi-k2.7-code` | 262,144 | $0.95 | $4.00 | $0.19 |
  | `@cf/nvidia/nemotron-3-120b-a12b` | 256,000 | $0.50 | $1.50 | — |

  Alex did not give a separate ruling on §9 Q4 (quality-bar tolerance) or Q6 (>64K context
  usage) — the model-choice decision above stands regardless of those answers, so they are
  superseded rather than separately closed.

- **Not addressed by this ruling — still open:** §9 Q3 (real server-side Claude token/cost
  baseline) and §9 Q5 (data-residency sign-off for enterprise tiers on Chinese-origin open
  weights) were not part of tg#5903/tg#5904 and have no ruling here. Flag both before an
  enterprise-tier rollout; do not assume they're settled by this section.

- **Usage logging / accounting (new, tg#5904 point 4).** Every AI call through the new proxy
  must be correlated to a user/installation id in PostHog (product analytics), plus a
  structured log entry per call: `{model, inputTokens, outputTokens, actionType, clientId}`,
  for future usage-based accounting.
  - **SaaS server:** keys off the real authenticated `userId`, already available via
    `c.get('userId')` in `server/routes/ai-agent.ts`.
  - **VS Code extension:** has no login/auth today — confirmed
    `vscode-extension/hypercanvas-preview/src/stubs/authFetch.ts` is a stub that throws. Keys
    off an opaque per-installation client id, using the same hashing approach the extension's
    existing `TelemetryService` already uses (`hashString(vscode.env.machineId)` in
    `src/telemetry/TelemetryService.ts`).
  - **Caveat (corrected 2026-08-13 — see §9b):** the SaaS *server* has no PostHog SDK today
    (`posthog-js` in `client/App.tsx`, PR #598, is browser-side only). The VS Code *extension*
    is not in the same boat, though — it already depends on `posthog-node` and sends host-side
    events (`src/telemetry/sender.ts`). So the accurate framing is "no SaaS-server PostHog
    integration yet," not "PostHog is client-side only" project-wide — **but this existing
    extension telemetry does NOT satisfy the per-call accounting requirement above**: it's
    consent/key-gated (inactive by default), doesn't record token counts, and its scrubber
    strips model slugs containing `/` (every `@cf/...` id). The managed proxy needs its own
    authoritative accounting path; see §9b. Full server-side wiring is not required immediately;
    the requirement is that the new proxy code has clear hook points (a named function/call
    site) for this logging, even if the first version is a stub, and that
    it doesn't duplicate what the extension's existing telemetry already reports.
  - Full implementation tracked in
    [HYP-881](https://linear.app/glide-vc/issue/HYP-881/unified-cloudflare-workers-ai-default-provider-glm-52kimi-k2nemotron).

- **Credentials status (blocker, found during this investigation).** No Cloudflare Workers AI
  credentials exist anywhere in the org as of 2026-07-03 — confirmed absent from
  `gh secret list --repo hyperide/hyper-saas`, `.env`/`.env.example`, and `k8s/`. This blocks
  any real end-to-end wiring. Per Alex's explicit instruction, the spec and a code skeleton
  (with clear `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_AI_API_TOKEN` env-var TODOs that fail
  loudly instead of silently) are being prepared now regardless; real activation is blocked on
  Alex provisioning the token. Tracked in
  [HYP-881](https://linear.app/glide-vc/issue/HYP-881/unified-cloudflare-workers-ai-default-provider-glm-52kimi-k2nemotron).

- **Implementation status:** the decision (§9a) is FINAL and binding, but **no implementation
  PR exists yet** — see §9b below for why "final decision" does not mean "ready to build as
  written." Tracked in
  [HYP-881](https://linear.app/glide-vc/issue/HYP-881/unified-cloudflare-workers-ai-default-provider-glm-52kimi-k2nemotron).

---

## 9b. Known implementation gaps (found in deeper technical review, 2026-08-13)

§9a settled the *product/policy* decision. It did not vet the *mechanism* against the actual
code. A multi-model review pass against the real call paths (`AIBridge.ts`, `ai-agent.ts`,
`ai-agent-core.ts`, `lib/ai-client/config.ts`, `server/database/schema/projects.ts`) found that
several of §6/§7's mechanics, if implemented literally as described, do not hold up. These are
not nitpicks — several are security-relevant — and **HYP-881 must resolve them before any code
ships**, not discover them mid-implementation:

- **Two agent loops stay unmerged, contradicting §9a's "unify the agent code."** §7.1/§7.2 keep
  the extension's `runChat`/`FetchOpenAIProvider` loop and the server's separate tool loop in
  `server/services/ai-agent.ts` as two independent implementations that both get "smoke-tested."
  §9a's unification only covers the upstream HTTP call, not the loop. Left as-is, every
  fallback/malformed-tool/accounting fix has to land twice and will drift again. The server
  Cloudflare path should consume the same shared provider loop as the extension, with a
  server-specific `ToolExecutor`.
- **The extension's actual credential-resolution order defeats the "no direct call" rule.**
  `AIBridge.ts` resolves the API key and performs a direct bearer-authenticated fetch *before*
  it would branch on provider — adding `cloudflare` as one more `'openai'`-protocol entry (as
  §7.1 step 1 describes) does not by itself stop the extension from calling Cloudflare directly.
  The managed-proxy requirement needs an explicit transport/credential mode (e.g.
  `managed-proxy`) that branches *before* key resolution, not just a new provider ID.
- **The credit-funded SaaS default is blocked by today's mandatory-BYOK schema**, not just
  missing an enum value: `ai_config.apiKey` is non-nullable, project-config creation rejects a
  missing key, the agent route rejects a project with no AI config, and the editor redirects
  keyless workspaces to Settings. §7.1's "add the enum" is necessary but not sufficient — the
  key-required gate has to be relaxed for server-managed providers, with a test proving chat
  works on a fresh workspace with no `ai_config` row and no user key.
- **The extension's proxy-auth story is spoofable as described.** §9a's "backend must hold the
  Cloudflare token" needs *some* per-installation identity to enforce quotas; the closest thing
  discussed (hashed `machineId`, same approach as `TelemetryService`) is an unauthenticated
  client-supplied value — trivially forgeable to drain the shared $5k credit. This needs a
  signed installation credential or account-pairing, not a bare hashed ID, with quota
  enforcement done server-side.
- **Reusing the existing custom-`baseURL` mechanism (§7.1's suggested wrinkle-fix for the
  account-scoped Cloudflare URL) is a credential-exfiltration path for a server-managed
  provider**, because the resolver passes a user-editable `baseURL` through unchanged and the
  server then sends its own bearer credential to whatever URL comes out. The Cloudflare
  account/gateway URL must be built exclusively from trusted server-side env values, with the
  three approved model IDs allowlisted — never from a client-supplied `baseURL` or model field.
- **The literal `@cf/...` model IDs in §2/§9a won't get Gateway fallback as configured.**
  Cloudflare's Gateway REST contract needs a `cf-aig-gateway-id` header and, for cross-model
  fallback, a deployed Dynamic Route invoked as `dynamic/<route>` — not the raw `@cf/...` model
  string. §7.2's "just point the base URL at Gateway" undersells the setup, and Gateway cannot
  fall back after a malformed tool-call stream has already been delivered to the client (so it
  does not cover the tool-call-format failure mode §7.2 implies it does).
- **Token accounting and prefix caching (§9a's usage-logging requirement, §4's caching benefit)
  aren't representable in the current stream types.** Neither the extension's nor the server's
  SSE parser carries a `usage` field on the final chunk, and neither sends a stable
  `x-session-affinity` header, so the "caching is free" framing in §4 assumes plumbing that
  doesn't exist yet. Both need a usage-accumulation path and one affinity ID propagated across
  a whole tool round before per-call `{model, inputTokens, outputTokens}` logging is possible.
- **The migration plan misses two non-chat call sites.** `WrapperGenerator` and
  `SampleAIGenerator` in the extension independently read the BYOK secret and call the upstream
  provider directly, bypassing the chat loop entirely. Flipping the extension's default provider
  does not touch either of them — both need to route through the same managed transport, or
  they silently keep calling the old provider (or break) after the flip.
- **Smaller factual errors also found and fixed inline during the same pass:**
  - The §4.1 extension-cost arithmetic was off by 10x on the input term — see the corrected
    figure above (now ~10.5x-17.7x pricier, not "2-3x"). That figure still compares Cloudflare's
    `glm-4.7-flash` per-token price against the extension's actual Z.ai `glm-4.7` **flat-rate**
    product as a stand-in (§4.1 already says so) — treat it as an order-of-magnitude proxy, not
    the real current Z.ai bill.
  - The §9a PostHog inventory said "PostHog is client-side only," which is too broad: the
    extension's telemetry (`posthog-node`) already runs server-side; only the SaaS *server* has
    no PostHog SDK. Corrected in §9a. This does **not** mean extension telemetry already
    satisfies §9a's per-call accounting requirement, though — see the next point.
  - **Confirmed, not just flagged:** the SaaS client (`AISettings.tsx`) initializes a new,
    unconfigured project to `glm`, while the database schema and service-layer fallback
    (`projects.ts`, `service.ts`) default to `claude`. This is an existing drift in the
    repository today, independent of anything this spec proposes — §6's "the SaaS server
    defaults to Claude" is accurate for the DB/service layer only. Any provider-default work
    (this spec's or otherwise) needs one aligned client/schema/service default, with a test
    covering all three, not three independently-maintained "current defaults."
- **One more gap found in this round, not yet reflected above:** §9a's per-call PostHog/
  structured-logging requirement cannot be satisfied by the extension's *existing* telemetry as
  a substitute. That telemetry is consent- and API-key-gated (inactive by default), `AIBridge`
  does not record token counts today, and its payload scrubber strips any model slug containing
  `/` (which every Cloudflare model id does, e.g. `@cf/zai-org/glm-5.2`). The managed backend
  proxy has to be the authoritative source for success/failure/abort, the actual fallback model
  used, and token totals per call — the extension's telemetry stays a separate, optional,
  client-UX-only signal, not a stand-in for accounting.

None of this reopens §9a's policy decision — it stays FINAL. It means §7's "small-to-medium"
migration checklist is not a complete implementation plan; HYP-881 needs a design pass on the
points above (most urgently the credential/auth ones) before code lands, not just the checklist
as literally written.

---

## 10. Recommendation summary

> **§9a is the binding decision, not this section.** Alex ruled on §9 in tg#5903/tg#5904
> (2026-07-03); see §9a. The bullets below are kept as the original research-based reasoning,
> not as an open proposal. Note where §9a diverges from what was recommended here: §9a is
> **unified across both surfaces with no Claude default anywhere** (not a tiered free-vs-paid
> split with Claude fallback), and it is **stricter on security** — a mandatory backend-proxied
> token-broker for the extension, not an optional mitigation. The migration mechanics (§7.1:
> `AI_PROVIDER_DEFAULTS` entry, `resolveAIConfig()` case, Postgres enum migration, UI wiring,
> streaming+tools smoke test) are a starting checklist, not a complete plan — see **§9b** for
> the gaps a deeper technical review found in that checklist before treating it as
> implementation-ready.

- Add `cloudflare` as a provider on the existing `openai` path, routed through **AI Gateway**
  — this bullet still stands, §9a keeps it.
- ~~**Extension:** make `@cf/zai-org/glm-5.2` the default (upgrade over GLM-4.7), credit-funded
  for a free tier, Claude/pro via gateway fallback.~~ **Superseded by §9a:** no free/paid tier
  split — GLM-5.2 is the default for everyone, no Claude fallback tier.
- ~~**Server:** GLM-5.2 selectable + default for free/pilot with **Claude auto-fallback**;
  Claude stays default for paid/pro.~~ **Superseded by §9a:** same correction — no Claude
  default on any tier, on either surface.
- Spend the $5k proving real HyperIDE task-success metrics (edit-apply success, tool-call
  validity, retries, fallback rate, TTFT, cost/action) GLM-5.2 vs Claude on the actual product.
- Only then decide a global default flip. This satisfies "top models + use the $5k credit"
  without gambling the paid product on an untested default.

---

## 11. Sources (fetched live 2026-07-02)

- Workers AI models catalog: https://developers.cloudflare.com/workers-ai/models/
- GLM-5.2 model page: https://developers.cloudflare.com/workers-ai/models/glm-5.2/
- GLM-5.2 launch changelog: https://developers.cloudflare.com/changelog/post/2026-06-16-glm-52-workers-ai/
- Pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Limits: https://developers.cloudflare.com/workers-ai/platform/limits/
- Function calling: https://developers.cloudflare.com/workers-ai/features/function-calling/
- Prompt caching: https://developers.cloudflare.com/workers-ai/features/prompt-caching/
- OpenAI compatibility: https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
- Batch API: https://developers.cloudflare.com/workers-ai/features/batch-api/
- AI Gateway: https://developers.cloudflare.com/ai-gateway/
- Cloudflare AI platform (agents): https://blog.cloudflare.com/ai-platform/
- Large models (Kimi K2.5, Infire engine): https://blog.cloudflare.com/workers-ai-large-models/
- GLM-5.2 provider perf/price (independent): https://artificialanalysis.ai/models/glm-5-2/providers
- GLM-5.2 coding benchmarks: https://venturebeat.com/technology/z-ais-open-weights-glm-5-2-beats-gpt-5-5-on-multiple-long-horizon-coding-benchmarks-for-1-6th-the-cost ; https://apidog.com/blog/glm-5-2-benchmarks/ ; https://benchlm.ai/models/glm-5-2
- gpt-oss-120b benchmarks: https://benchlm.ai/models/gpt-oss-120b
- BFCL leaderboard: https://gorilla.cs.berkeley.edu/leaderboard.html
- SWE-bench Verified tracker: https://benchlm.ai/benchmarks/sweVerified
