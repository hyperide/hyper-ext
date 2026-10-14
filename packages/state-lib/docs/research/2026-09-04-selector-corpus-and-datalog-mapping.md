# A corpus of production selectors, and what a Datalog layer would and would not replace

> **2026-09-08 correction notice.** This is the full original study, retained with its method and all 22 records. Its stronger claims about Datalog inexpressibility, automatic result identity and clean equivalence are superseded by the [review and explicit contracts](/query-research). The original gap predicate and expiry direction were incorrect; corrected comparison cards and executable normalized fixtures are on the [query page](/selectors-vs-datalog). Counts describe this sample, not a representative benchmark. The original snippets are excerpts, not complete programs.

**Date:** 2026-09-04 · **Requirements:** R66 (Datalog-vs-selectors showcase), R32 (query layer) · **Method:** GitHub REST content API via `gh`, every file read in full or in the cited range, every citation pinned to a commit SHA · **Corpus:** 22 selector chains from 7 repositories

R66's previous artefact — `2026-09-04-r66-ivm-vs-selectors-first-run.md` — ends by admitting that its benchmark fixture is synthetic, and asks for "a real selector pyramid from a production codebase". This document is the other half of that request: not a measurement, a survey. It answers a question the benchmark cannot, namely **which selector shapes a declarative query layer actually replaces**, and it answers it by reading production code rather than by reasoning about what selectors probably look like.

Nothing here is measured. No performance claim in this document has a number behind it, and where a source's own authors complain about cost their complaint is quoted rather than quantified.

## Summary of what the corpus shows

Five findings, in descending order of how much they should change our plans.

1. **Sorting is one of the most common stages in the corpus, and Datalog has no sort.** Six of the twenty-two chains sort — behind filtering (twelve) and joining (seven), level with aggregation — and three of the six sort on a locale-aware collation. Datomic queries return unordered sets and the language has no `order-by`, `limit` or `offset` at all. Any claim that queries replace selector pyramids has to be stated as "queries replace the selection and joining stages; ordering stays outside the query", or it is false. This is not a detail to be handled later — it is the top of the pyramid in most of the corpus.

2. **A substantial fraction of the code in these selectors is not about data at all — it is memoization plumbing.** Mattermost's `makeGetChannelsByCategory` is sixty-one lines of which roughly half maintain per-category selector instances, a `lastCategories` cache and a `shallowEquals` identity check; three other chains end with a line whose only purpose is to return the _previous_ array when the new one is equal. This code has no counterpart in a query language: it does not map, because it ceases to exist. That is the strongest argument for the query layer in the whole corpus, and it is an argument about code volume and bug surface, not speed.

3. **Two shapes do not map at all, and one of them is common.** Sequential scans that emit synthetic rows (date separators, "new messages" markers) and run-length collapsing of consecutive rows are both ordinary chat-timeline work, both present in Mattermost, and both inexpressible in Datalog, which has no notion of a row's position among its neighbours. SQL needs window functions for these; Datomic has no equivalent.

4. **Recursive traversal maps _better_ than the JavaScript.** Gutenberg hand-rolls a splice loop to collect block descendants and a `while` loop to walk ancestors; both are three-line Datalog rules. This is the one shape where the query form is unambiguously the better code.

5. **Two independent codebases document the same bug — a wall-clock predicate inside a memoized selector — and a query layer does not fix it either.** Signal's `getComposableContacts` and Mastodon's `getFilters` both compare entity timestamps against "now", and Signal's own comment concedes the result goes stale. Passing `?now` as a query input makes the _predicate_ expressible; it does nothing about _when the view is recomputed_. Time-dependent derivation is an unsolved problem in both worlds and we should stop treating it as a selector problem.

## Provenance and honesty about coverage

GitHub code search and the contents API were both available and neither rate-limited during this pass. Every file below was downloaded and read; the SHA in each repository's row was independently re-fetched and the downloaded bytes diffed against the pinned revision, so the permalinks resolve to exactly the text quoted.

The corpus is **not** a random sample. It is biased towards applications whose derived state is genuinely hard: chat clients, an editor, a media manager, a plugin catalogue. Tutorials, todo apps and `createSlice` examples were excluded deliberately, as were chains whose inputs are all `state => state.x` with a trivial body. Three repositories that were candidates turned out to have removed or restructured the code since it was famous — `nteract/nteract` no longer has a `selectors` package, `firefox-devtools/debugger` is archived and its `src/` tree is gone, and Metabase's `query_builder/selectors.js` no longer exists at that path. None of those are in the corpus; no example here is reconstructed from memory or from a blog post.

| Repository                 | Licence                                                                                                                                       | Head SHA (pinned)                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `signalapp/Signal-Desktop` | AGPL-3.0-only                                                                                                                                 | `aee156c662c64dc6cbe5e363325565f5cbd7203a` |
| `mattermost/mattermost`    | Apache-2.0 for `webapp/` and subdirectories (the repository root is AGPL-3.0 or commercial; the licence text carves out `webapp/` explicitly) | `1807e4b68183e1462bb535b726f4fec3a8980004` |
| `WordPress/gutenberg`      | GPL-2.0-or-later (contributions dual GPL/MPL-2.0)                                                                                             | `24a28a95b0f7e92c46231906f6fd0c3b1987b679` |
| `zulip/zulip-mobile`       | Apache-2.0                                                                                                                                    | `d7cf6da79b4b9467e240b42f24330e97390a8aff` |
| `mastodon/mastodon`        | AGPL-3.0                                                                                                                                      | `0a32b4a831838ef1f363a915c2e71e2a1b52cf0d` |
| `Radarr/Radarr`            | GPL-3.0                                                                                                                                       | `04e27cb264104973e531cf5226430dabf5611786` |
| `grafana/grafana`          | AGPL-3.0                                                                                                                                      | `c6fad8695a96577eb466d425e6ac4a759ca30f47` |

All quotations below are a few lines at most, for identification and criticism, with attribution. Copyright remains with the respective projects.

## The corpus

"Depth" counts `createSelector` (or `createIdsSelector` / `createAppSelector`) layers from raw state to the named result, not lines. Where a chain is assembled by a plain function calling several memoized selectors in sequence — Mattermost does this repeatedly — the depth given is the longest path through it.

| #   | Repo         | Path (line)                                                                                                                                                                                                                              | What it computes                                                                                                                               | Depth | Primary shape                |
| --- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------- |
| 1   | Signal       | [`ts/state/selectors/conversations.dom.ts:503`](https://github.com/signalapp/Signal-Desktop/blob/aee156c662c64dc6cbe5e363325565f5cbd7203a/ts/state/selectors/conversations.dom.ts#L503)                                                  | Left pane: split every conversation into pinned / active / archived, sort each                                                                 | 3     | Partition + sort             |
| 2   | Signal       | [`conversations.dom.ts:1104`](https://github.com/signalapp/Signal-Desktop/blob/aee156c662c64dc6cbe5e363325565f5cbd7203a/ts/state/selectors/conversations.dom.ts#L1104)                                                                   | A function resolving a conversation by _any_ of four identifiers                                                                               | 3     | Keyed lookup                 |
| 3   | Signal       | [`conversations.dom.ts:755`](https://github.com/signalapp/Signal-Desktop/blob/aee156c662c64dc6cbe5e363325565f5cbd7203a/ts/state/selectors/conversations.dom.ts#L755)                                                                     | Total unread counts across all conversations, honouring the mute setting                                                                       | 2     | Aggregate                    |
| 4   | Signal       | [`conversations.dom.ts:813`](https://github.com/signalapp/Signal-Desktop/blob/aee156c662c64dc6cbe5e363325565f5cbd7203a/ts/state/selectors/conversations.dom.ts#L813)                                                                     | Contacts eligible for the composer, excluding unregistered ones                                                                                | 2     | Filter (clock-dependent)     |
| 5   | Signal       | [`ts/state/selectors/search.preload.ts:120`](https://github.com/signalapp/Signal-Desktop/blob/aee156c662c64dc6cbe5e363325565f5cbd7203a/ts/state/selectors/search.preload.ts#L120)                                                        | Search results: three id lists resolved to entities, each wrapped in a loading state                                                           | 3     | Join / denormalise           |
| 6   | Mattermost   | [`…/selectors/entities/channel_categories.ts:96`](https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/channel_categories.ts#L96) | Which direct-message channels stay in the sidebar: filter, count unreads, sort by three keys, keep the top _N_ where _N_ depends on that count | 2     | Windowing / top-N            |
| 7   | Mattermost   | [`channel_categories.ts:416`](https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/channel_categories.ts#L416)                    | Sidebar channels grouped by category — a per-category selector factory plus a hand-written result cache                                        | 5+    | Memoization plumbing         |
| 8   | Mattermost   | [`channel_categories.ts:274`](https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/channel_categories.ts#L274)                    | Sort channels by display name, where a direct message's display name is derived from the other user and a naming preference                    | 2     | Sort                         |
| 9   | Mattermost   | [`…/selectors/entities/channels.ts:614`](https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/channels.ts#L614)                   | "Is there anything unread anywhere" — nine inputs across five slices, two running sums, collapsed to a flag                                    | 3     | Aggregate → flag             |
| 10  | Mattermost   | [`channels.ts:167`](https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/channels.ts#L167)                                        | A channel with the other user's name and presence filled in                                                                                    | 2     | Denormalise for render       |
| 11  | Mattermost   | [`…/utils/post_list.ts:46`](https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/utils/post_list.ts#L46)                                             | The timeline id list: filter posts, then interleave synthetic date separators and a "new messages" marker                                      | 3     | Sequential scan              |
| 12  | Mattermost   | [`post_list.ts:162`](https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/utils/post_list.ts#L162)                                                   | Collapse runs of consecutive join/leave posts into one combined item, capped at 100                                                            | 3     | Run-length collapse          |
| 13  | Mattermost   | [`…/selectors/entities/posts.ts:243`](https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/posts.ts#L243)                         | A thread: root post plus replies, filtered and sorted                                                                                          | 2     | Join + filter + sort         |
| 14  | Gutenberg    | [`packages/block-editor/src/store/selectors.js:269`](https://github.com/WordPress/gutenberg/blob/24a28a95b0f7e92c46231906f6fd0c3b1987b679/packages/block-editor/src/store/selectors.js#L269)                                             | Every descendant block id of a set of roots, in document order                                                                                 | 1     | Recursive traversal          |
| 15  | Gutenberg    | [`selectors.js:320`](https://github.com/WordPress/gutenberg/blob/24a28a95b0f7e92c46231906f6fd0c3b1987b679/packages/block-editor/src/store/selectors.js#L320)                                                                             | How many blocks exist, optionally of one type, counting nested ones                                                                            | 2     | Aggregate over closure       |
| 16  | Gutenberg    | [`selectors.js:635`](https://github.com/WordPress/gutenberg/blob/24a28a95b0f7e92c46231906f6fd0c3b1987b679/packages/block-editor/src/store/selectors.js#L635)                                                                             | The ancestor chain of a block, filtered to given block types                                                                                   | 2     | Recursive traversal + filter |
| 17  | zulip-mobile | [`src/unread/unreadSelectors.js:138`](https://github.com/zulip/zulip-mobile/blob/d7cf6da79b4b9467e240b42f24330e97390a8aff/src/unread/unreadSelectors.js#L138)                                                                            | The unreads screen: streams → topics → counts, joined to subscriptions, sorted twice at each level                                             | 2     | Nested group-by              |
| 18  | zulip-mobile | [`unreadSelectors.js:22`](https://github.com/zulip/zulip-mobile/blob/d7cf6da79b4b9467e240b42f24330e97390a8aff/src/unread/unreadSelectors.js#L22)                                                                                         | Unread count per stream excluding muted topics, then the grand total                                                                           | 3     | Group-by count → sum         |
| 19  | Mastodon     | [`app/javascript/mastodon/selectors/notifications.ts:59`](https://github.com/mastodon/mastodon/blob/0a32b4a831838ef1f363a915c2e71e2a1b52cf0d/app/javascript/mastodon/selectors/notifications.ts#L59)                                     | How many notification groups are newer than the read marker, across two lists                                                                  | 4     | Filter → count               |
| 20  | Mastodon     | [`app/javascript/mastodon/selectors/filters.ts:22`](https://github.com/mastodon/mastodon/blob/0a32b4a831838ef1f363a915c2e71e2a1b52cf0d/app/javascript/mastodon/selectors/filters.ts#L22)                                                 | Content filters applicable to a context and not yet expired                                                                                    | 2     | Filter (clock-dependent)     |
| 21  | Radarr       | [`frontend/src/Store/Selectors/createClientSideCollectionSelector.js:122`](https://github.com/Radarr/Radarr/blob/04e27cb264104973e531cf5226430dabf5611786/frontend/src/Store/Selectors/createClientSideCollectionSelector.js#L122)       | A generic filter-and-sort engine driven by user-saved filters and a sort key held in state                                                     | 2     | Runtime-configured query     |
| 22  | Grafana      | [`public/app/features/plugins/admin/state/selectors.ts:46`](https://github.com/grafana/grafana/blob/c6fad8695a96577eb466d425e6ac4a759ca30f47/public/app/features/plugins/admin/state/selectors.ts#L46)                                   | Plugin catalogue search: fuzzy keyword match plus four flag filters                                                                            | 3     | Filter (fuzzy) + side effect |

## Shape taxonomy

Two counts, because one is misleading on its own. Assigning each chain a single "primary shape" undercounts sorting badly, since sorting is almost never the whole of a selector but is very often the last thing it does.

### Primary shape

| Shape                                                 | Count  | Entries      |
| ----------------------------------------------------- | ------ | ------------ |
| Aggregate / rollup to a scalar or flag                | 4      | 3, 9, 15, 19 |
| Filter by predicate over one collection               | 3      | 4, 20, 22    |
| Partition and group-by                                | 3      | 1, 17, 18    |
| Join across slices / denormalise for render           | 3      | 5, 10, 13    |
| Recursive graph traversal                             | 2      | 14, 16       |
| Sequential scan (synthetic rows, run-length collapse) | 2      | 11, 12       |
| Sort as the substance of the selector                 | 1      | 8            |
| Windowing / top-N                                     | 1      | 6            |
| Keyed lookup by alternate identifiers                 | 1      | 2            |
| Runtime-configured query interpreter                  | 1      | 21           |
| Memoization plumbing with no data meaning             | 1      | 7            |
| **Total**                                             | **22** |              |

### Stage frequency

How many of the twenty-two chains contain each stage anywhere in them. A chain can and usually does contribute to several rows. This classification is a judgement call in a handful of borderline cases and should be read as approximate.

| Stage                                                      | Chains | Maps to Datalog?                               |
| ---------------------------------------------------------- | ------ | ---------------------------------------------- |
| Filter / selection                                         | 12     | Yes, cleanly                                   |
| Join across slices                                         | 7      | Yes — this is what Datalog is for              |
| Sort                                                       | 6      | **No** — no ordering in the language           |
| Aggregate                                                  | 6      | Yes, for `count`/`sum`; partly for `min`/`max` |
| Materialise entities from an id list                       | 5      | Yes, via `pull`                                |
| Identity-preserving return (return the old array if equal) | 4      | Not applicable — the concern disappears        |
| Recursive traversal                                        | 3      | Yes, better than the JavaScript                |
| Group-by                                                   | 3      | Yes, flat; **no** for nested results           |
| Positional / order-sensitive logic                         | 3      | **No**                                         |
| Wall-clock read inside the selector                        | 3      | Partly — see the "does not map" section        |
| Locale-aware collation                                     | 3      | **No**                                         |
| Top-N / windowing                                          | 1      | **No**                                         |
| Side effect inside the selector                            | 1      | **No**                                         |

## Mapping, shape by shape

Datalog forms are written in Datomic's map or vector query syntax, per the [query data reference](https://docs.datomic.com/query/query-data-reference.html). The "incremental" column asks whether a change to the underlying data can be turned into a change to the result without recomputing from scratch — the property `deriveCollection` demonstrates in the R66 benchmark.

### 1. Filter by predicate — maps cleanly

Grafana's plugin catalogue filter (#22) is four independent flag comparisons plus a keyword match; Mastodon's notification filter (#19) is a set-membership test against a list of excluded types.

Selector form, Mastodon [`notifications.ts:24`](https://github.com/mastodon/mastodon/blob/0a32b4a831838ef1f363a915c2e71e2a1b52cf0d/app/javascript/mastodon/selectors/notifications.ts#L24):

```js
return notifications.filter((item) => item.type === 'gap' || !excludedTypes.includes(item.type));
```

Datalog form:

```clojure
[:find [(pull ?n [*]) ...]
 :in $ ?excluded-set
 :where
 [?n :notification/type ?type]
 (or [(= ?type "gap")]
     (not [(contains? ?excluded-set ?type)]))]
```

(Binding the exclusions as a set and negating one `contains?` predicate, rather than as a collection `[?excluded ...]` — a collection binding is a cross-product, so a negated equality against it would keep every notification that differs from _at least one_ excluded type, which is every notification. The trap is the same one `:with` guards against in §4: Datalog's set semantics quietly turn a wrong query into a plausible answer.)

Multi-flag conjunction (Grafana) is just more `:where` clauses, and the optionality of each flag — Grafana writes `if (filters.type && plugin.type !== filters.type) return false` four times — becomes either a rule with two heads or a query built with the clause present or absent. Both are less code than the JavaScript.

**Incremental:** yes, trivially. A selection is the easiest case in incremental view maintenance: each inserted or retracted datom is tested once against the predicate.

### 2. Join across slices — maps cleanly, and is the strongest case

This is the shape Datalog exists for, and it is the second most common stage in the corpus. Mattermost's thread selector (#13) reaches into `posts`, `postsInThread`, the current user and a preference; Signal's search (#5) resolves three id lists against two lookup tables; Mattermost's `getUnreadStatus` (#9) declares nine inputs.

Selector form, Mattermost [`posts.ts:246`](https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/posts.ts#L246) — the inputs alone:

```ts
getAllPosts,
getCurrentUser,
(state: GlobalState, rootId: string) => state.entities.posts.postsInThread[rootId],
(state: GlobalState, rootId: string) => state.entities.posts.posts[rootId],
shouldShowJoinLeaveMessages,
```

Datalog form — the join that the four input functions and the loop body add up to:

```clojure
[:find [(pull ?p [:post/id :post/message :post/create-at
                  {:post/author [:user/username :user/id]}]) ...]
 :in $ ?root ?show-join-leave ?join-leave-types
 :where
 (or [(ground ?root) ?p]
     [?p :post/root ?root])
 (not-join [?p ?show-join-leave ?join-leave-types]
   [(false? ?show-join-leave)]
   [?p :post/type ?t]
   [(contains? ?join-leave-types ?t)])]
```

The win is not brevity, it is that the join is _declared_ rather than performed. In the selector, the fact that `postsInThread[rootId]` is a list of ids into `posts` is knowledge held by the loop body; nothing checks it and nothing else can use it. Note also that the selector's last line is `thread.sort(comparePosts)` — the query above returns a set, and that sort has to happen somewhere else. See §5.

**Incremental:** yes. Joins are the well-trodden part of incremental view maintenance; the cost is the index memory to maintain them.

### 3. Keyed lookup by alternate identifiers — maps cleanly, with one semantic difference worth knowing

Signal's `getConversationByAnyIdSelector` (#2) builds four lookup tables (by id, by service id, by phone number, by group id) in four separate selectors and then tries them in a fixed order.

Selector form, Signal [`conversations.dom.ts:1078`](https://github.com/signalapp/Signal-Desktop/blob/aee156c662c64dc6cbe5e363325565f5cbd7203a/ts/state/selectors/conversations.dom.ts#L1078) (abridged):

```ts
const onGroupId = getOwn(byGroupId, id);
if (onGroupId) {
  return onGroupId;
}
const onServiceId = getOwn(byServiceId, normalizeServiceId(id, 'getConversationSelector'));
if (onServiceId) {
  return onServiceId;
}
```

Datalog form — with the four identifiers declared `:db/unique`, the four derived index selectors are not needed at all:

```clojure
[:find (pull ?c [*]) .
 :in $ ?key
 :where
 (or-join [?c ?key]
   [?c :conversation/id ?key]
   [?c :conversation/service-id ?key]
   [?c :conversation/e164 ?key]
   [?c :conversation/group-id ?key])]
```

**The semantic difference:** `or-join` yields a set with no precedence. The selector's cascade encodes a priority — group id beats service id beats phone number beats id — which matters if the same string could match two different conversations on two different attributes. That precedence is real information and the query above silently loses it; recovering it needs either three fallback queries or a rule with ordered heads and an explicit rank. Worth flagging because it is the sort of thing a "queries are simply better" demo would gloss over.

**Incremental:** not applicable in the interesting sense — this is a point lookup against an index, which the store maintains anyway.

### 4. Aggregate and rollup — maps cleanly for counts and sums

Six chains aggregate. Mattermost's `getUnreadStatus` (#9) sums two counters over the user's memberships, skipping muted and deleted channels, and collapses the answer to a flag. Zulip (#18) counts unread message ids per stream and then totals them.

Selector form, Mattermost [`channels.ts:651`](https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/channels.ts#L651) (abridged from a fifty-line `reduce`):

```ts
if (isChannelMuted(membership)) {
  return counts;
}
const unreadCount = calculateUnreadCount(messageCounts[channelId], myMembers[channelId], collapsedThreads);
if (unreadCount.showUnread) {
  counts.messages += unreadCount.messages;
}
```

Datalog form:

```clojure
[:find (sum ?unread) .
 :with ?ch
 :in $ ?me
 :where
 [?m :membership/user ?me]
 [?m :membership/channel ?ch]
 [(missing? $ ?m :membership/muted-until)]
 [?ch :channel/deleted-at 0]
 [?ch :channel/unread-count ?unread]
 [(pos? ?unread)]]
```

The `:with ?ch` is load-bearing: without it two channels with the same unread count collapse into one tuple before the sum, because `:find` operates on a set. This is the classic Datalog aggregation trap and it is worth stating in any showcase, because the naive query silently returns a wrong number rather than failing.

Grouping is implicit — an ungrouped variable in `:find` beside an aggregate becomes the group key. Zulip's per-stream count is:

```clojure
[:find ?stream (count ?msg)
 :in $ ?me
 :where
 [?msg :message/stream ?stream]
 [?msg :message/unread-by ?me]
 (not-join [?stream ?msg ?me]
   [?msg :message/topic ?topic]
   [?mute :mute/user ?me] [?mute :mute/stream ?stream] [?mute :mute/topic ?topic])]
```

**Incremental:** `count` and `sum` yes — a delta adds or subtracts. `min` and `max` **no**, at least not cheaply: retracting the current extremum forces a rescan of the group unless a secondary structure is maintained. Zulip's `lastUnreadMsgId: msgIds.last()` (#17) is exactly a `max`, so this boundary is hit by real code in this corpus, not just in theory.

### 5. Sort — **does not map**, and this is the important one

Six of twenty-two chains sort. Datomic queries return sets; the language has no `order-by`, no `limit`, no `offset`. Sorting happens in the client after the query returns, which means a query layer replaces the _body_ of these selectors and leaves the last line where it was.

Three sub-cases, in increasing order of how badly they map:

**(a) Sort on a stored numeric attribute.** Signal's conversation comparator (#1) is mostly `rightTimestamp - leftTimestamp`. A query cannot order by it, but an index over the attribute can, and this is precisely what `deriveCollection` already maintains in the R66 fixture. So the shape survives — just not inside the query.

**(b) Multi-key sort with a fallback cascade.** Signal's comparator, quoted from [`conversations.dom.ts:342`](https://github.com/signalapp/Signal-Desktop/blob/aee156c662c64dc6cbe5e363325565f5cbd7203a/ts/state/selectors/conversations.dom.ts#L342), tries a draft-or-received timestamp, then a counter that "looks like a timestamp, but is actually a counter", then an `inboxPosition`, then the title. Mattermost's `makeFilterAutoclosedDMs` (#6) sorts by "current channel first, then unread, then last viewed". These are total orders composed from partial ones; expressible as a computed sort tuple, but nothing in the query language builds it.

**(c) Locale-aware collation.** `new Intl.Collator()` in Signal, `localeCompare(locale, {numeric: true})` in Mattermost [`channel_categories.ts:256`](https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/channel_categories.ts#L256), `caseInsensitiveCompareFunc` in Zulip — which [`src/utils/misc.js:5`](https://github.com/zulip/zulip-mobile/blob/d7cf6da79b4b9467e240b42f24330e97390a8aff/src/utils/misc.js#L5) defines as `a.toLowerCase().localeCompare(b.toLowerCase())`, so it is genuine collation in the default locale, not a byte comparison. This is not a comparison a query engine can perform: the ordering depends on a locale, on Unicode collation tables, and in Mattermost's case on a numeric-aware variant that sorts "Room 2" before "Room 10". A Rust/wasm engine could bind ICU, but that is a decision to make deliberately, not a thing that falls out.

There is also a detail worth preserving for its own sake. Zulip sorts twice, relying on `Array.prototype.sort` being stable, to get a two-key order ([`unreadSelectors.js:197`](https://github.com/zulip/zulip-mobile/blob/d7cf6da79b4b9467e240b42f24330e97390a8aff/src/unread/unreadSelectors.js#L197)):

```js
result.sort((a, b) => caseInsensitiveCompareFunc(a.streamName, b.streamName));
result.sort((a, b) => +b.isPinned - +a.isPinned);
```

**Incremental:** an ordered view _is_ maintainable — that is the R66 result — but by the view layer, not by the query. Any design where the query returns a set and the client sorts it throws away exactly the incrementality R66 measured. **This is the single most important design constraint the corpus produces:** ordering has to be part of the derived-view primitive, not bolted on after the query.

### 6. Partition and nested group-by — maps flat, does not map nested

Signal's left pane (#1) is a three-way partition in one pass: pinned, active, archived. That is three queries, or one query with the discriminator in `:find`, and either is fine.

Zulip's unreads screen (#17) is harder. It produces a tree: an array of streams, each carrying `data`, an array of its topics, each with a count and a `lastUnreadMsgId`. Datalog `:find` returns a flat relation. The flat part maps:

```clojure
[:find ?stream ?topic (count ?msg) (max ?msg-id)
 :in $ ?me
 :where
 [?msg :message/stream ?stream]
 [?msg :message/topic ?topic]
 [?msg :message/unread-by ?me]
 [?msg :message/id ?msg-id]
 [?sub :subscription/user ?me]
 [?sub :subscription/stream ?stream]]

;; => #{[stream-1 "topic a" 3 4471] [stream-1 "topic b" 1 4460] [stream-2 "x" 9 4502] …}
```

…and the re-nesting into `{streamName, unread, data: [...]}` is client-side work the query did not do. The join to `?sub` also does something the JavaScript does the long way round: Zulip skips streams with no subscription and explains in a nine-line comment why unreads can exist in an unsubscribed stream. In Datalog that is not a special case, it is the join.

**Incremental:** the flat grouped relation, yes, subject to the `max` caveat in §4. The nested reshape is a client-side fold and recomputes.

### 7. Recursive traversal — maps, and the query form is better

Gutenberg's descendant collection (#14) is a splice loop that inserts each block's children just after it, so that the output ends up in document order:

```js
while (index < ids.length) {
  const id = ids[index];
  const order = state.blocks.order.get(id);
  if (order) {
    ids.splice(index + 1, 0, ...order);
  }
  index++;
}
```

Datalog rules:

```clojure
[[(descendant ?ancestor ?child)
  [?child :block/parent ?ancestor]]
 [(descendant ?ancestor ?child)
  [?mid :block/parent ?ancestor]
  (descendant ?mid ?child)]]

[:find [?child ...] :in $ % ?root :where (descendant ?root ?child)]
```

The ancestor walk (#16) is the same rule read the other way, and its "filter to these block types" is one extra clause. The block count over the whole tree (#15) is `[:find (count ?d) . :in $ % ?root :where (descendant ?root ?d)]`.

**But the document order is lost.** Gutenberg needs the descendants in the order they appear in the editor — that is the whole point of the splice — and a rule returns a set. Recovering document order needs a materialised path or an ordering attribute, which is a data-model decision, not a query one. So even the shape that maps best runs into §5.

One incidental observation: Gutenberg's `createSelector` is `@wordpress/data`'s, not Reselect's, and takes an explicit dependants function — `( state ) => [ state.blocks.order ]`. The author hand-declares which parts of state the selector reads. That is a manually maintained, unverified approximation of what a query planner derives for free, and getting it wrong produces a stale view with no error.

**Incremental:** plausible but genuinely hard. Maintaining a transitive closure under deletion is the classic difficult case (the counting and DRed algorithms exist and are not cheap). This is the one shape where "incremental" should not be promised without a prototype.

### 8. Denormalise for render — maps partly; `pull` does projection, not computation

Mattermost's `makeGetChannel` (#10) returns a channel whose `display_name` has been replaced by the other user's name, formatted according to a "teammate name display" preference, with the teammate's presence attached. Signal's search (#5) turns id lists into entity lists.

`pull` handles the projection and the traversal, including reverse references and attribute renaming with `:as`, plus `:default` for missing values and `:xform` to transform a pulled value:

```clojure
[:find (pull ?ch [:channel/id
                  {:channel/teammate [:user/id :user/username :user/nickname
                                      :user/presence]}]) .
 :in $ ?ch]
```

What it does not do is _choose_ between `username`, `nickname` and `full-name` based on a server setting, which is what `displayUsername(teammate, teammateNameDisplay, false)` does. That choice is a computation over three attributes and a preference; it belongs in a view function, and honestly it always did — Mattermost puts it in a selector because a selector is the only place Redux offers.

The same applies to Signal's search result wrapper, which decides between `{ isLoading: true }` and `{ isLoading: false, results }`. Request lifecycle is not entity data. It can be modelled as an entity (a request with a status attribute) and then it queries fine, but nothing in the corpus models it that way today.

**Incremental:** yes for the projection; the computed attributes recompute per row, which is cheap because it is per-row.

### 9. Windowing and top-N — **does not map**

Mattermost's `makeFilterAutoclosedDMs` (#6) is the sharpest case in the corpus. It filters, counts unreads _during_ the filter, sorts by three keys, and then:

```ts
const remaining = Math.max(limitPref, unreadCount);
visibleChannels = visibleChannels.slice(0, remaining);
```

The window size is derived from an aggregate computed by the same pass. Datalog has no `:limit` — and even if it had one, a limit over an unordered set is meaningless, so the sort in §5 is a precondition for the window. Datomic's `(max n ?v)` aggregate returns the _n_ largest values of one variable, which is not the same as the _n_ top rows by a composite ordering.

The honest form is two phases: a query producing the candidate set and the count, then an ordered view that takes the first _n_. Which is to say the query layer does part of this and the view layer does the rest.

**Incremental:** a top-_N_ over a maintained ordered view is incremental (it is a prefix). A top-_N_ whose _N_ moves with an aggregate is incremental only if both the order and the count are maintained, and the interaction between them is a real design problem, not a detail.

### 10. Sequential scan and run-length collapse — **does not map at all**

Two chains, both Mattermost, both ordinary chat-timeline work.

`makeFilterPostsAndAddSeparators` (#11) walks the post list oldest-to-newest carrying two accumulators, `lastDate` and `addedNewMessagesIndicator`, and pushes **synthetic non-entity items** into the output — a `DATE_LINE` string when the day changes in the user's timezone, and a single `START_OF_NEW_MESSAGES` marker at the first unseen post. `makeCombineUserActivityPosts` (#12) then walks that list and merges runs of consecutive join/leave posts into one combined pseudo-item, up to a hundred:

```ts
if (postIsUserActivity && lastPostIsUserActivity && combinedCount < MAX_COMBINED_SYSTEM_POSTS) {
    out[out.length - 1] += '_' + postId;
```

Neither is expressible in Datalog under any reading. Datalog has no concept of a tuple's position relative to its neighbours, no ordinal, and no way to emit a row that does not correspond to an entity. In SQL these are window functions — `lag()`, and the gap-and-islands trick of grouping by `row_number() - rank()`. Datomic has no window functions.

Note also that these two are _chained_: the second reads the synthetic markers the first emitted (`isStartOfNewMessages(postId) || isDateLine(postId)`) and treats them as run-breakers. So it is not one awkward selector, it is a small pipeline whose intermediate representation is a list of mixed real and synthetic ids.

**Incremental:** in principle a run-length encoding can be maintained locally — inserting a post affects at most the runs adjacent to it — but nothing about that is a query, and the date separators depend on a timezone-shifted day boundary, which is its own entry in the does-not-map table below.

**This is the shape to be most careful about in any showcase.** A timeline with date separators is the most recognisable derived view in a chat application, and it is the one a Datalog layer cannot touch.

### 11. A selector that is already a query — maps by construction, and proves the point

Radarr's `createClientSideCollectionSelector` (#21) does not hard-code its predicates. It reads them out of state at runtime — user-saved custom filters, a selected filter key, a primary and secondary sort key with directions — and interprets them:

```js
const filtered = filter(state.items, state);
const sorted = sort(filtered, state);
```

`filter` walks a list of `{key, value, type}` clauses and applies a predicate looked up from a type table (`filterTypes.EQUAL`, `NOT_CONTAINS`, and friends); `sort` builds lodash `orderBy` clauses from the sort keys. That is a small query interpreter, hand-written, with its own predicate vocabulary.

Because the clauses are already data, the mapping is mechanical rather than a translation. Each `{key, value, type}` becomes a `:where` clause, and the whole clause list can be passed in as a relation:

```clojure
;; clauses supplied as data: [[:movie/monitored :eq true]
;;                            [:movie/quality-profile :in #{1 3}]]
[:find [(pull ?m [*]) ...]
 :in $ ?monitored [?profiles ...]
 :where
 [?m :movie/monitored ?monitored]
 [?m :movie/quality-profile ?profiles]]
```

Two things follow. First, this is the corpus's clearest evidence that **applications reach for a query language whether or not one is provided** — Radarr built a worse one rather than do without. Second, and more usefully: this hand-rolled query language _has ordering_, with a primary and a secondary key and per-key direction, because a user-facing collection is unusable without it. A language modelled on Datomic would have been rejected here for exactly the gap in §5.

**Incremental:** the filter half, yes. The sort half is the §5 problem again, and here it is the user's to change at runtime — which means the ordering cannot be baked into an index chosen at build time. Any ordered-view primitive we ship has to accept its comparator as data.

## Does not map

Collected, so the list can be argued with rather than discovered later.

| Thing                              | Where in the corpus                  | Why not                                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordering of results                | 6 chains (#1, #6, #8, #13, #17, #21) | No `order-by` in the language; queries return sets                                                                                                                                                                               |
| `limit` / `offset` / top-_N_       | #6                                   | Absent from the language, and meaningless without order                                                                                                                                                                          |
| Locale-aware collation             | #1, #8, #17                          | `Intl.Collator`, `localeCompare(locale, {numeric:true})` — needs Unicode collation data, not a predicate                                                                                                                         |
| Position-relative logic            | #11, #12, #14                        | No ordinals, no `lag`, no window functions, no gap-and-islands                                                                                                                                                                   |
| Emitting synthetic non-entity rows | #11                                  | The result of a query is entities and their values; a date separator is neither                                                                                                                                                  |
| Fuzzy / relevance matching         | #22                                  | `uFuzzy` ranking is a scoring function, not a truth-valued predicate                                                                                                                                                             |
| Timezone-aware date bucketing      | #11                                  | `moment.tz.zone(timezone).utcOffset(...)` — a library and a tz database                                                                                                                                                          |
| Formatting for display             | #10                                  | `displayUsername(teammate, setting, false)` — a computation over attributes and a preference                                                                                                                                     |
| Request lifecycle (`isLoading`)    | #5                                   | Not entity data as currently modelled; modellable, but nobody models it                                                                                                                                                          |
| Side effects                       | #22                                  | `debouncedTrackSearch(filteredPlugins.length)` fires analytics from inside a memoized selector — it reports the search only when the memo misses, which is a bug in waiting and has no place to live in a pure query             |
| UI hysteresis                      | #1                                   | `stableSelectedConversationIdInChatFolder` keeps the open conversation in the list after it stops matching the filter, purely so the row does not vanish under the cursor. The predicate depends on _what was true a moment ago_ |
| Identity-preserving returns        | #6, #7, #12, #16                     | Pure memoization artefacts — see below                                                                                                                                                                                           |

### The clock, which half-maps and deserves its own note

Three chains read wall-clock time inside a memoized selector. Mastodon [`filters.ts:32`](https://github.com/mastodon/mastodon/blob/0a32b4a831838ef1f363a915c2e71e2a1b52cf0d/app/javascript/mastodon/selectors/filters.ts#L32):

```js
const now = new Date();
```

…and Signal, in a comment above `getComposableContacts` at [`conversations.dom.ts:808`](https://github.com/signalapp/Signal-Desktop/blob/aee156c662c64dc6cbe5e363325565f5cbd7203a/ts/state/selectors/conversations.dom.ts#L808):

> "Because they filter unregistered contacts and that's (partially) determined by the current time, it's possible for them to return stale contacts that have unregistered if no other conversations change. This should be a rare false positive."

Two independent teams, the same defect, one of them documented as accepted. Datalog takes the clock as an input — `:in $ ?now` with `[(< ?expires ?now)]` — which makes the _predicate_ clean. It does nothing about the real problem, which is that nothing invalidates the view when the clock passes a threshold. A query layer that binds `?now` and then caches the result reproduces the bug exactly. Solving it needs either a scheduled invalidation at the next threshold the data implies, or an explicit "this view is time-dependent" contract. **Neither the query layer nor the incremental view layer as currently designed has anything to say about this, and we should stop implying that they do.**

### Memoization plumbing, which does not map because it evaporates

Mattermost [`channel_categories.ts:447`](https://github.com/mattermost/mattermost/blob/1807e4b68183e1462bb535b726f4fec3a8980004/webapp/channels/src/packages/mattermost-redux/src/selectors/entities/channel_categories.ts#L447) — the authors' own diagnosis. The excerpt below omits the leading maintenance annotation before “This”; it is not byte-for-byte verbatim. The substantive comment wording is retained, and the pinned full source above includes the annotation:

```ts
// This avoids some rendering, but there is a bigger issue underneath
// Every time myPreferences or myChannels change (which can happen for many
// unrelated reasons) the whole list of channels gets reordered and re-filtered.
```

That is R66's thesis, written by the maintainers of a chat client with tens of thousands of stars, about their own sidebar. The surrounding code is the workaround: `makeGetChannelsByCategory` allocates a fresh `makeFilterAndSortChannelsForCategory` per category, keeps `lastCategories` and `lastChannelsByCategory`, rebuilds the whole selector set when the category array's identity changes, and finishes with a `shallowEquals` pass to return the previous object if nothing differs. Roughly half of its sixty-one lines are that bookkeeping. `makeGetChannelIdsForCategory` has a smaller version of the same. `makeFilterAutoclosedDMs` ends with:

```ts
return filteredChannels.length === channels.length ? channels : filteredChannels;
```

— returning the _input array_ when the filter removed nothing, so that the downstream memo does not break. `makeCombineUserActivityPosts` tracks a `changed` flag for the same reason. Gutenberg returns a shared `EMPTY_ARRAY` constant.

None of this is about channels, posts or blocks. It exists because the derivation model is "recompute and compare identities", and every one of these lines is a place a bug can hide — return the wrong array and a view goes stale with no error anywhere. Under a maintained view there is nothing to preserve the identity of, because nothing was rebuilt.

The model fails in the other direction too. Grafana's `selectPlugins` is `(filters) => createSelector(...)` — a **new** memoized selector constructed on every call, so a caller that does not hoist it gets a memo that never hits and re-runs the fuzzy search every render. Grafana does hoist it, in [`state/hooks.ts:32`](https://github.com/grafana/grafana/blob/c6fad8695a96577eb466d425e6ac4a759ca30f47/public/app/features/plugins/admin/state/hooks.ts#L32):

```ts
const selector = useMemo(() => selectPlugins(filters), [filters]);
```

…which is the correct defensive move and also the point. The selector is only memoized because a _different file_ wrapped its construction in a `useMemo`, and that `useMemo` is only effective while `filters` — an object — keeps its identity. Nothing in the selector's own source says any of this, no type expresses it, and nothing fails loudly if a caller gets it wrong. **The correctness of a memoized derivation is a property of where it was constructed, not of what it computes**, and that is precisely the property a declarative query layer removes from the programmer's hands.

The same call site supplies an unplanned data point for §5: the very next line is `sortPlugins(plugins, sortBy)` — the sort has already been moved _out_ of the selector and into the hook, un-memoized, running on every render. One team in this corpus has already arrived at the division a Datalog layer would impose, and paid for it with a sort that never memoizes.

**If R66 wants one honest argument for the query layer that does not depend on a benchmark, it is this one, and Mattermost wrote it down themselves.**

### The inverse case

Worth reading §11 alongside this section. Radarr's selector is the mirror image of Mattermost's: instead of accumulating memoization plumbing around a hard-coded derivation, its author gave up and wrote a small query interpreter whose clauses live in state. The two failure modes bracket the argument for the query layer — one codebase pays in cache bookkeeping, the other pays by reinventing the language.

## Still unknown

1. **Whether these Redux slices are Datalog-shaped at all without re-modelling.** The mapping above assumes entities with stable ids and attributes. Some of the corpus is not like that. Zulip's unread model is a nested `Map<streamId, Map<topic, List<msgId>>>` in which topics are strings, not entities, and messages appear only as ids — there are no message attributes to query. Gutenberg keeps order in `state.blocks.order`, a `Map` of child-id arrays, so position is data rather than a derivable property. Converting either to datoms is a design exercise with its own cost, and nothing here measures it. The companion document `2026-09-04-normalisation-and-conversion-landscape.md` is the right place for that question and this one should be read against it.

2. **Whether Danny-DB supports what these mappings use.** Every Datalog snippet above is Datomic syntax and assumes aggregates (`count`, `sum`, `max`), `:with`, recursive rules with `%`, `or-join` / `not-join`, and `pull` with nested and reverse specs. Which of those the Rust/wasm engine will have is not settled, and the ones the corpus leans on hardest are aggregates and rules. If rules are out, §7 is out with them.

3. **What the query planner costs.** R66's benchmark measured `deriveCollection`, the patch-driven primitive, at about 4.5× the cost of hand-written incremental code for one query shape. A Datalog layer adds planning on top of that. The benchmark has no column for it. Until it does, "queries are faster than selectors" is not a claim we can make — only "maintaining a view beats recomputing it" is, which is a claim about the layer underneath.

4. **How ordering is expressed.** §5 is a design gap, not a research gap: if `derive.collection` maintains an order and the query returns a set, something has to connect them. Whether ordering is a property of the derived view, an extension to the query language, or a separate operator is undecided, and it determines whether six of the twenty-two chains are covered end-to-end or only halfway.

5. **Whether incremental maintenance of a recursive rule is worth building.** §7 says "plausible but hard" on the strength of the general literature, not on anything tried here. Gutenberg's block tree is the natural test case and it is not in the benchmark.

6. **Whether the corpus generalises.** Twenty-two chains from seven repositories, chosen for being hard, four of them chat clients. The shape distribution is very likely skewed by that. A dashboard-heavy or e-commerce-heavy sample would probably weight aggregation and pagination higher and recursive traversal to zero.

## Candidates for the benchmark fixture

R66's first run asked for a real pyramid to replace the synthetic filter-sort-group fixture. Two candidates, both with the useful property of being self-contained enough to port without dragging in a framework:

- **Mattermost's sidebar pipeline** (#6 → #8 → #7): filter archived, filter manually closed, filter autoclosed with a data-dependent top-_N_, sort by a runtime-chosen strategy, group by category. It is the corpus's deepest chain, its authors have documented that it recomputes on unrelated changes, and it exercises the filter/sort/group shape the current fixture approximates — with the top-_N_ and the per-key memoization that the current fixture does not have.
- **Zulip's unreads screen** (#17 + #18): group-by two levels, count, join to subscriptions, sort twice. Smaller, and it isolates the aggregate-plus-`max` case where incremental maintenance is known to be awkward, which makes it the more informative of the two if only one gets built.

Neither has been ported. Both would need the data model question in "Still unknown" (1) answered first.
