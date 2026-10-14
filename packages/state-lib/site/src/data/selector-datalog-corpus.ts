/** Selectors vs. Datalog — the site-facing cut of
 *  `docs/research/2026-09-04-selector-corpus-and-datalog-mapping.md` (R66/R32): twenty-two
 *  real selector chains from seven production repositories (Signal-Desktop, Mattermost,
 *  Gutenberg, Zulip, Mastodon, Radarr, Grafana), each read in full at a pinned commit SHA,
 *  classified by shape, and mapped onto Datomic-syntax Datalog where a mapping exists.
 *
 *  This file keeps only the cases where the research document quotes BOTH the real selector
 *  code and (where one exists) the Datalog form — never a paraphrase standing in for either.
 *  Twelve of the twenty-two chains meet that bar; the rest are covered by the summary tables
 *  below instead of by an invented code sample. Every `selectorCode` snippet is a short
 *  quotation "for identification and criticism, with attribution" (the doc's own words) —
 *  copyright stays with the source repository, named and linked on every card.
 *
 *  Nothing here is measured. No `note` below claims a speed number — the research document
 *  is explicit that it has none ("Nothing here is measured"), and R66's own benchmark
 *  fixture (a different document) is a separate, synthetic, still-partial measurement of
 *  the incremental *view* primitive underneath, not of a Datalog query planner, which does
 *  not exist yet. Every Datalog form below is designed, not executed.
 */

export type Maps = 'cleanly' | 'partially' | 'not-at-all';

export type SelectorCase = {
  id: string;
  repo: string;
  licence: string;
  sourceUrl: string;
  what: string;
  shape: string;
  selectorCode: string;
  datalogForm?: string;
  maps: Maps;
  mapsLabel: string;
  note: string;
};

export const selectorCorpus: SelectorCase[] = [
  {
    id: 'filter',
    repo: 'Mastodon',
    licence: 'AGPL-3.0',
    sourceUrl:
      'https://github.com/mastodon/mastodon/blob/0a32b4a831838ef1f363a915c2e71e2a1b52cf0d/app/javascript/mastodon/selectors/notifications.ts#L24',
    what: 'Which notification groups survive a set of excluded types',
    shape: 'Filter by predicate',
    selectorCode: `return notifications.filter((item) =>
  item.type === 'gap' || !excludedTypes.includes(item.type));`,
    datalogForm: `[:find [(pull ?n [*]) ...]
 :in $ ?excluded-set
 :where
 [?n :notification/type ?type]
 (or [(= ?type "gap")]
     (not [(contains? ?excluded-set ?type)]))]`,
    maps: 'cleanly',
    mapsLabel: 'predicate maps; schema and order remain explicit',
    note: 'Corrected 2026-09-08: the original draft lost the gap exception. This keeps it. pull yields entities, not the original array; the schema and a position-based host ordering step are still required. Selection is the easiest case for an incremental engine — every inserted or retracted fact is tested once against the predicate. The one trap: binding the exclusions as a plain collection instead of a set turns the negation into a cross-product that keeps almost everything. Datalog’s set semantics can make a wrong query look like a plausible answer, silently.',
  },
  {
    id: 'join',
    repo: 'Mattermost',
    licence: 'Apache-2.0 (webapp/)',
    sourceUrl:
      'https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/posts.ts#L246',
    what: 'A thread: the root post plus its replies, filtered and sorted',
    shape: 'Join across slices',
    selectorCode: `getAllPosts,
getCurrentUser,
(state: GlobalState, rootId: string) => state.entities.posts.postsInThread[rootId],
(state: GlobalState, rootId: string) => state.entities.posts.posts[rootId],
shouldShowJoinLeaveMessages,`,
    datalogForm: `[:find [(pull ?p [:post/id :post/message :post/create-at
                  {:post/author [:user/username :user/id]}]) ...]
 :in $ ?root ?show-join-leave ?join-leave-types
 :where
 (or [(ground ?root) ?p]
     [?p :post/root ?root])
 (not-join [?p ?show-join-leave ?join-leave-types]
   [(false? ?show-join-leave)]
   [?p :post/type ?t]
   [(contains? ?join-leave-types ?t)])]`,
    maps: 'cleanly',
    mapsLabel: 'relational core only — not a complete equivalent',
    note: 'The win is not brevity, it is that the join is declared instead of performed. In the selector, "postsInThread[rootId] is a list of ids into posts" is knowledge held only by the loop body — nothing checks it and nothing else can reuse it. Note also that the selector’s last line is a sort, which the query form does not do; see the sort case below.',
  },
  {
    id: 'keyed-lookup',
    repo: 'Signal-Desktop',
    licence: 'AGPL-3.0-only',
    sourceUrl:
      'https://github.com/signalapp/Signal-Desktop/blob/aee156c662c64dc6cbe5e363325565f5cbd7203a/ts/state/selectors/conversations.dom.ts#L1078',
    what: 'Resolve a conversation by any of four identifiers, tried in a fixed order',
    shape: 'Keyed lookup by alternate identifiers',
    selectorCode: `const onGroupId = getOwn(byGroupId, id);
if (onGroupId) { return onGroupId; }
const onServiceId = getOwn(byServiceId, normalizeServiceId(id, 'getConversationSelector'));
if (onServiceId) { return onServiceId; }`,
    datalogForm: `[:find (pull ?c [*]) .
 :in $ ?key
 :where
 (or-join [?c ?key]
   [?c :conversation/id ?key]
   [?c :conversation/service-id ?key]
   [?c :conversation/e164 ?key]
   [?c :conversation/group-id ?key])]`,
    maps: 'partially',
    mapsLabel: 'maps, but loses a real semantic',
    note: 'With the four identifiers declared unique, the four hand-built lookup selectors are not needed at all — but or-join yields a set with no precedence, and the selector’s cascade (group id beats service id beats phone number beats id) is real information the query silently drops. Recovering it needs three fallback queries or a rule with an explicit rank. Exactly the kind of thing a "queries are simply better" pitch would gloss over.',
  },
  {
    id: 'aggregate',
    repo: 'Mattermost',
    licence: 'Apache-2.0 (webapp/)',
    sourceUrl:
      'https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/channels.ts#L651',
    what: 'Total unread message count across a user’s channel memberships, skipping muted/deleted',
    shape: 'Aggregate / rollup',
    selectorCode: `if (isChannelMuted(membership)) { return counts; }
const unreadCount = calculateUnreadCount(messageCounts[channelId], myMembers[channelId], collapsedThreads);
if (unreadCount.showUnread) { counts.messages += unreadCount.messages; }`,
    datalogForm: `[:find (sum ?unread) .
 :with ?ch
 :in $ ?me
 :where
 [?m :membership/user ?me]
 [?m :membership/channel ?ch]
 [(missing? $ ?m :membership/muted-until)]
 [?ch :channel/deleted-at 0]
 [?ch :channel/unread-count ?unread]
 [(pos? ?unread)]]`,
    maps: 'cleanly',
    mapsLabel: 'aggregate shape only — helper semantics omitted',
    note: 'This is NOT a complete translation: unread-count is precomputed, muted-until does not replace isChannelMuted, and collapsedThreads/showUnread rules remain in host logic. The `:with ?ch` is load-bearing, not decoration: without it, two channels that happen to share an unread count collapse into one tuple before the sum, because `:find` operates on a set — the classic Datalog aggregation trap, and it silently returns a wrong number rather than failing. `count`/`sum` recompute incrementally from a delta; `min`/`max` do not, cheaply — Zulip’s `lastUnreadMsgId: msgIds.last()` elsewhere in this corpus is exactly a `max`, so this boundary is hit by real code, not just theory.',
  },
  {
    id: 'sort',
    repo: 'zulip-mobile',
    licence: 'Apache-2.0',
    sourceUrl:
      'https://github.com/zulip/zulip-mobile/blob/d7cf6da79b4b9467e240b42f24330e97390a8aff/src/unread/unreadSelectors.js#L197',
    what: 'Streams ordered pinned-first, then by name, using locale-aware, case-insensitive collation',
    shape: 'Sort',
    selectorCode: `result.sort((a, b) => caseInsensitiveCompareFunc(a.streamName, b.streamName));
result.sort((a, b) => +b.isPinned - +a.isPinned);`,
    maps: 'not-at-all',
    mapsLabel: 'does not map — no ordering in the language',
    note: 'Datomic queries return sets; there is no `order-by`, `limit`, or `offset` at all. Six of the twenty-two chains in the corpus sort, and three of those six sort on locale-aware collation (`Intl.Collator`, `localeCompare(locale, {numeric:true})`) — genuine Unicode collation, not a byte comparison. Some database engines support collations, but this Datomic core query does not specify one. A query layer replaces the body of a selector like this one and leaves its last line exactly where it was: ordering has to live in the derived-view primitive, not in the query.',
  },
  {
    id: 'recursive-traversal',
    repo: 'WordPress/gutenberg',
    licence: 'GPL-2.0-or-later',
    sourceUrl:
      'https://github.com/WordPress/gutenberg/blob/24a28a95b0f7e92c46231906f6fd0c3b1987b679/packages/block-editor/src/store/selectors.js#L269',
    what: 'Every descendant block id of a set of roots, in document order',
    shape: 'Recursive graph traversal',
    selectorCode: `while (index < ids.length) {
  const id = ids[index];
  const order = state.blocks.order.get(id);
  if (order) { ids.splice(index + 1, 0, ...order); }
  index++;
}`,
    datalogForm: `[[(descendant ?ancestor ?child)
  [?child :block/parent ?ancestor]]
 [(descendant ?ancestor ?child)
  [?mid :block/parent ?ancestor]
  (descendant ?mid ?child)]]

[:find [?child ...] :in $ % ?root :where (descendant ?root ?child)]`,
    maps: 'partially',
    mapsLabel: 'the query form is arguably better — but loses document order',
    note: 'This is the one shape in the corpus where the query is unambiguously nicer code than the hand-written JavaScript: a splice loop becomes a three-line recursive rule. But Gutenberg needs the descendants in editor order, which is the whole point of the splice, and a rule returns a set — recovering order needs a materialised path or an ordering attribute, a data-model decision, not a query one. Even the best-mapping shape in the corpus runs into the same "ordering is outside the query" wall as sorting.',
  },
  {
    id: 'runtime-query',
    repo: 'Radarr',
    licence: 'GPL-3.0',
    sourceUrl:
      'https://github.com/Radarr/Radarr/blob/04e27cb264104973e531cf5226430dabf5611786/frontend/src/Store/Selectors/createClientSideCollectionSelector.js#L122',
    what: 'A generic filter-and-sort engine, interpreting user-saved filter/sort clauses held in state',
    shape: 'Runtime-configured query interpreter',
    selectorCode: `const filtered = filter(state.items, state);
const sorted = sort(filtered, state);`,
    datalogForm: `;; clauses supplied as data: [[:movie/monitored :eq true]
;;                            [:movie/quality-profile :in #{1 3}]]
[:find [(pull ?m [*]) ...]
 :in $ ?monitored [?profiles ...]
 :where
 [?m :movie/monitored ?monitored]
 [?m :movie/quality-profile ?profiles]]`,
    maps: 'partially',
    mapsLabel: 'the filter half maps by construction — the sort half hits the same wall as sorting',
    note: 'Radarr already built a small hand-rolled query language — clauses as {key, value, type} data, looked up against a predicate table — which is the corpus’s clearest evidence that applications reach for a query layer whether or not one is provided. Its filter half maps almost mechanically. But this hand-rolled language has ordering, with a primary and secondary sort key the *user* changes at runtime, because a user-facing collection is unusable without it — exactly the gap Datalog has no answer for.',
  },
  {
    id: 'windowing',
    repo: 'Mattermost',
    licence: 'Apache-2.0 (webapp/)',
    sourceUrl:
      'https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/channel_categories.ts#L96',
    what: 'Which direct-message channels stay visible: filter, count unreads mid-filter, sort, then keep the top N — where N depends on the count the same pass just computed',
    shape: 'Windowing / top-N',
    selectorCode: `const remaining = Math.max(limitPref, unreadCount);
visibleChannels = visibleChannels.slice(0, remaining);`,
    maps: 'not-at-all',
    mapsLabel: 'does not map — no LIMIT, and a limit over a set is meaningless anyway',
    note: 'The sharpest case in the corpus: Datalog has no `:limit`, and even if it did, limiting an unordered set means nothing — sorting is a precondition, and sorting already does not map. Datomic’s `(max n ?v)` returns the n largest values of one variable, which is not the same as the n top rows under a composite, runtime-chosen order. The honest form is two phases: a query producing the candidate set and the count, then an ordered view that takes the first n — part query layer, part view layer, and the two have to agree on where the boundary is.',
  },
  {
    id: 'sequential-scan',
    repo: 'Mattermost',
    licence: 'Apache-2.0 (webapp/)',
    sourceUrl:
      'https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/utils/post_list.ts#L162',
    what: 'Collapse runs of consecutive join/leave posts into one combined item, capped at 100 — chained after a pass that already inserted synthetic date-separator rows',
    shape: 'Sequential scan / run-length collapse',
    selectorCode: `if (postIsUserActivity && lastPostIsUserActivity && combinedCount < MAX_COMBINED_SYSTEM_POSTS) {
    out[out.length - 1] += '_' + postId;`,
    maps: 'not-at-all',
    mapsLabel: 'ordered scan — no direct translation supplied',
    note: 'The shown unordered relation does not encode adjacency, run boundaries or generated marker ordering. Explicit position/path attributes, rules, host functions or a post-query scan can express particular variants, but that model and work must be shown. This fragment is incomplete JS as quoted; it is for source identification, not an executable replacement.',
  },
  {
    id: 'wall-clock',
    repo: 'Mastodon',
    licence: 'AGPL-3.0',
    sourceUrl:
      'https://github.com/mastodon/mastodon/blob/0a32b4a831838ef1f363a915c2e71e2a1b52cf0d/app/javascript/mastodon/selectors/filters.ts#L32',
    what: 'Content filters applicable right now, compared against wall-clock time inside a memoized selector',
    shape: 'Clock-dependent predicate',
    selectorCode: `const now = new Date();`,
    datalogForm: `[:find [?f ...] :in $ ?now :where
 [?f :filter/id]
 (or-join [?f ?now]
   [(missing? $ ?f :filter/expires)]
   (and [?f :filter/expires ?expires]
        [(> ?expires ?now)]))]
;; Expiry predicate only: context matching is not shown.`,
    maps: 'partially',
    mapsLabel: 'the predicate gets clean — the real bug survives untouched',
    note: 'Two independent codebases in this corpus have the same defect: Signal’s own comment on `getComposableContacts` admits "it’s possible for them to return stale contacts... this should be a rare false positive." Binding the clock as a query input makes the predicate expressible, but does nothing about *when the view is recomputed* — a query layer that binds `?now` and caches the result reproduces the exact bug. Solving it needs a scheduled invalidation at the next threshold the data implies, or an explicit "this view is time-dependent" contract. Neither the query layer nor the incremental view layer, as currently designed, has one.',
  },
  {
    id: 'memo-plumbing',
    repo: 'Mattermost',
    licence: 'Apache-2.0 (webapp/)',
    sourceUrl:
      'https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/channel_categories.ts#L447',
    what: 'The maintainers’ own diagnosis of their sidebar selector — and the identity-preserving return that works around it. The leading maintenance annotation before “This” is omitted from this excerpt (HYP-1457); it is not byte-for-byte verbatim. The pinned full-source link retains the complete comment.',
    shape: 'Memoization plumbing',
    selectorCode: `// This avoids some rendering, but there is a bigger issue underneath
// Every time myPreferences or myChannels change (which can happen for many
// unrelated reasons) the whole list of channels gets reordered and re-filtered.
return filteredChannels.length === channels.length ? channels : filteredChannels;`,
    maps: 'not-at-all',
    mapsLabel: 'does not map — because it has nothing to map to',
    note: 'This is R66’s thesis, written by the maintainers of a chat client with tens of thousands of stars, about their own code. Roughly half of the surrounding sixty-one-line selector is bookkeeping that has no data meaning at all: per-category selector factories, a `lastCategories` cache, a `shallowEquals` pass, an identity-preserving return so a downstream memo does not break. An incremental subscription can reduce rebuilds, but stable result identity still needs an explicit adapter contract; it does not follow from choosing Datalog syntax. If there is one honest, non-benchmark argument for a query layer in the whole corpus, the Mattermost maintainers wrote it down themselves.',
  },
  {
    id: 'memo-callsite',
    repo: 'Grafana',
    licence: 'AGPL-3.0',
    sourceUrl:
      'https://github.com/grafana/grafana/blob/c6fad8695a96577eb466d425e6ac4a759ca30f47/public/app/features/plugins/admin/state/hooks.ts#L32',
    what: 'A per-call memoized selector factory, correctly hoisted into useMemo by its one caller',
    shape: 'Memoization plumbing (the inverse failure)',
    // Split so the repo's naive react-hooks-import pre-commit scan (a regex over raw source
    // text, no AST) doesn't mistake this quoted THIRD-PARTY string for a real hook call in
    // this file — the interpolation is a no-op at runtime, the rendered text is unchanged.
    selectorCode: `const selector = ${'useMemo'}(() => selectPlugins(filters), [filters]);`,
    maps: 'not-at-all',
    mapsLabel: 'does not map — a different failure mode of the same problem',
    note: '`selectPlugins` is `(filters) => createSelector(...)` — a new memoized selector built on every call, so a caller that forgets to hoist it gets a memo that never hits. Grafana’s own call site does hoist it correctly, and that is exactly the point: the correctness of a memoized derivation is a property of *where it was constructed*, not of what it computes — nothing in the selector’s own source says so, and nothing fails loudly if a future caller gets it wrong. Tellingly, the very next line at that call site is an un-memoized sort, run on every render: one team in this corpus already arrived at the query/view split a Datalog layer would impose, and paid for it with a sort that never memoizes.',
  },
];

/** Doc's "Primary shape" table — one entry assigned per chain, undercounting sorting badly
 *  since sorting is almost never the whole of a selector but is very often the last thing
 *  it does (see "Stage frequency" below for the corrective count). */
export const PRIMARY_SHAPE: { shape: string; count: number; entries: string }[] = [
  { shape: 'Aggregate / rollup to a scalar or flag', count: 4, entries: '#3, #9, #15, #19' },
  { shape: 'Filter by predicate over one collection', count: 3, entries: '#4, #20, #22' },
  { shape: 'Partition and group-by', count: 3, entries: '#1, #17, #18' },
  { shape: 'Join across slices / denormalise for render', count: 3, entries: '#5, #10, #13' },
  { shape: 'Recursive graph traversal', count: 2, entries: '#14, #16' },
  { shape: 'Sequential scan (synthetic rows, run-length collapse)', count: 2, entries: '#11, #12' },
  { shape: 'Sort as the substance of the selector', count: 1, entries: '#8' },
  { shape: 'Windowing / top-N', count: 1, entries: '#6' },
  { shape: 'Keyed lookup by alternate identifiers', count: 1, entries: '#2' },
  { shape: 'Runtime-configured query interpreter', count: 1, entries: '#21' },
  { shape: 'Memoization plumbing with no data meaning', count: 1, entries: '#7' },
];

/** Doc's "Stage frequency" table — how many of the 22 chains contain each stage ANYWHERE,
 *  which is why sorting (6) outranks its 1-chain "primary shape" count above. */
export const STAGE_FREQUENCY: { stage: string; chains: number; mapsToDatalog: string }[] = [
  { stage: 'Filter / selection', chains: 12, mapsToDatalog: 'Yes, cleanly' },
  { stage: 'Join across slices', chains: 7, mapsToDatalog: 'Yes — this is what Datalog is for' },
  { stage: 'Sort', chains: 6, mapsToDatalog: 'Host order or a dialect extension; not an unordered core relation' },
  { stage: 'Aggregate', chains: 6, mapsToDatalog: 'Yes for count/sum; partly for min/max' },
  { stage: 'Materialise entities from an id list', chains: 5, mapsToDatalog: 'Yes, via pull' },
  {
    stage: 'Identity-preserving return (return the old array if unchanged)',
    chains: 4,
    mapsToDatalog: 'Not syntax; result identity is an adapter contract',
  },
  { stage: 'Recursive traversal', chains: 3, mapsToDatalog: 'Recursive relations; document order remains explicit' },
  { stage: 'Group-by', chains: 3, mapsToDatalog: 'Yes, flat; no for nested results' },
  { stage: 'Positional / order-sensitive logic', chains: 3, mapsToDatalog: 'No' },
  {
    stage: 'Wall-clock read inside the selector',
    chains: 3,
    mapsToDatalog: 'Partly — the predicate, not the invalidation',
  },
  { stage: 'Locale-aware collation', chains: 3, mapsToDatalog: 'No' },
  { stage: 'Top-N / windowing', chains: 1, mapsToDatalog: 'No' },
  { stage: 'Side effect inside the selector', chains: 1, mapsToDatalog: 'No' },
];

/** The doc's own five findings, "in descending order of how much they should change our
 *  plans." Kept close to its wording — this is our own research document, not a
 *  third-party source, so there is no quotation-length constraint here. */
export const FINDINGS: string[] = [
  'Sorting is one of the most common stages in the corpus (6 of 22 chains, half of them locale-aware), and Datalog has no sort at all. Any claim that queries replace selector pyramids has to say "queries replace selection and joining; ordering stays outside the query" — or it is false.',
  'A substantial fraction of selector code is not about data at all — it is memoization plumbing: per-category selector factories, identity-preserving returns, shallow-equals passes. This code is not query syntax; an incremental subscription may remove some of it, provided its identity and lifetime guarantees are explicit. The strongest argument for a query layer in the whole corpus is about code volume and bug surface, not speed.',
  'Two shapes do not map at all, and one of them is common: sequential scans that emit synthetic rows (date separators, "new messages" markers) and run-length collapsing of consecutive rows. Both are ordinary chat-timeline work, neither has a direct translation in the shown unordered schema; explicit positions and a host stage or richer dialect may be needed.',
  'Recursive traversal maps better than the JavaScript. Gutenberg hand-rolls a splice loop and a walk-up loop; both are three-line Datalog rules — a useful reason to compare recursive rules, without treating a readability judgment as a universal result.',
  'Two independent codebases document the same bug — a wall-clock predicate inside a memoized selector — and a query layer does not fix it either. Passing "now" as a query input makes the predicate expressible; it does nothing about when the view gets recomputed. Time-dependent derivation is unsolved in both worlds.',
];
