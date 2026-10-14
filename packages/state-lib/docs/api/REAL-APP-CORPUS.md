# State-lib API: реальные сценарии, контрпримеры и границы

HYP-1464 · 2026-09-16. Это старт исполняемого app-derived корпуса, не финальное утверждение API v1.

## Метод

Берём конкретные операции и инварианты из реального приложения, закрепляем исходник SHA, формулируем собственный независимый oracle и исполняем сценарий на существующей state-lib реализации. Переставляем ответы/ошибки/отмену, проверяем независимые читатели, транзакции и identity. Новые workload-файлы написаны самостоятельно; код внешних приложений не включён в пакет.
Прочитать исходник ≠ запустить или портировать приложение. Здесь НЕ выполнялись полные Excalidraw, Plane или Cal.com и НЕ измерялось сравнение их производительности.
Проверяемые source URL, commit SHA и SHA256 прочитанных файлов: `../../experiments/real-apps/sources.json`.

| Источник                                                     | Реальная операция                                                                                                              | Собственная проверка state-lib                                                                                                                             | Чего она не доказывает                                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Excalidraw, a9186480121a, packages/element/src/store.ts      | Раздельные immediate/eventual/never capture; remote edits не должны попадать в local undo                                      | Atomic group edits, nested rejection, coherent scene, committed notification errors — runtime/src/app-contracts.test.ts                                    | Не реализованы upstream capture/history, rebase remote edits, CRDT, full canvas rendering                                                              |
| Plane, a8961152ed30, base-issues.store.ts и issue9049        | Каноническая issue map и отдельно обновляемые filtered/grouped ID buckets могут разойтись; parent/display-фильтр подавляет ADD | Независимый derived board от normalized rows; move/add/remove/empty/missingID/staged create/rebind/rollback — normalized-apps.check.mjs                    | Не запускался original Plane; business filter и backend success не исправляются автоматически generic state engine                                     |
| Cal.com/cal.diy, 6bc45298226f, Booker/store.ts + useSlots.ts | Selected date/duration/timeslot, availability request, reservation ID; final server booking остаётся арбитром                  | Out-of-order availability, supersession, ignored abort, immediate cancellation settlement, current errors, atomic result publication — latest-task.test.ts | Это усиленный counterfactual workload, не утверждение об upstream race bug; нет server reservation, cache policy, timezones/DST или payment guarantees |

## Реализация этого среза

Добавлен необязательный typed reference-модуль `runtime/src/latest-task.ts`. Он использует СУЩЕСТВУЮЩИЙ Runtime.transaction для публикации, а не другую реактивную модель из сайта. Загрузка выполняется снаружи транзакции; только актуальный ticket может синхронно опубликовать результат.
`run` возвращает committed/superseded/cancelled. Loader получает AbortSignal. Отмена снимает право на commit даже при игнорировании сигнала и завершает ожидание вызывающей стороны без ожидания сети. Поздний Promise продолжает иметь обработчик ошибок, но не может изменить state.
При уже начавшемся commit его реальный результат важнее отмены из callback: NotificationError.committed нельзя скрыть как cancelled или считать rollback. Async commit отклоняется strict типами и существующим runtime-guard. За границами guard types/unsafe casts обычные ограничения JavaScript сохраняются.
Название latestTask и сигнатура — кандидат reference API. Нет неявного root-owned disposal, retry/cache/persist или distributed atomicity. Owner обязан вызывать dispose; loader, игнорирующий AbortSignal, может продолжать внешнюю работу. Вход следует передавать как стабильный ключ/immutable request snapshot.

## Продолжение: исправление normalized membership

2026-09-16, следующий проход: все4 исходных RED-сценария устранены в существующем NormalizedStore. Добавлены и исправлены3 контрпримера: escaped view из отменённого создания, создание+удаление без commit, integer-key ordering. Ещё1200 детерминированных mixed edit/rollback шагов сверяются с независимым эталонным канбаном. Старые compile-access/normalized controls сохранены.
Table handles теперь стабильные live proxies; membership/absent-ID являются реактивными зависимостями; staged additions/deletions видны через `.state`. Aborted/net-zero creation отзывает generation выданных view, не позволяя им ожить при повторном ID. Это исправление эксперимента, НЕ перенос его реактивной модели в отдельный Runtime и не утверждение API v1.

## Уже полученные контрпримеры

В normalized workload:7 tests,3pass/4fail на неизменённом normalized.mjs. Это не ошибка Plane, автоматически приписанная state-lib: тесты исполняют именно существующий NormalizedStore.

| Контрпример                                                               | Почему важен для реального API                                                                 | Требуемое исправление                                                                |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Сохранённый `const rows = store.state.issues` устаревает после add/remove | Компонент/derived может сохранить table handle; при удалении старый getter даже бросает ошибку | Стабильный live table handle, tracked membership, missing-entity subscriptions       |
| Пустая коллекция не просыпается на первом insert                          | Пока строк нет, наблюдатель не прочитал ни одного поля                                         | Явная зависимость на membership, не только на поля уже существующих строк            |
| `put` внутри action не виден через `.state` до commit                     | Обычная JS-семантика read-your-writes нарушается при create-and-edit                           | Membership overlay из committed+staged rows, не перестройка root только после commit |
| `store.state.issues.later` не подписывает появление сущности              | Loading/absent view не должен навсегда остаться undefined                                      | Dependency на existence отсутствующего ID, включая повторное создание                |

Схема исправления сохранена как proposal вне исходников: state-lib-api-20260916/live-table-proposal.mjs. Первая команда интеграции была отклонена до выполнения; после нового штатного согласования исправление реализовано и проверено в следующем проходе (см. выше). Исходные RED-тесты остались активными и теперь проходят; это ещё не итоговый release-вердикт всей программы.
Отдельный новый async-модуль прошёл собственный настоящий RED→GREEN: отмена сначала не завершала ожидание provider, который никогда не отвечает. Добавлена revocation-promise; тест затем прошёл. Это отличается от начального missing-module RED, который доказывал только отсутствие файла.

## Что это говорит об API

| Область            | Нормативное намерение                                                                         | Нынешняя граница / следующий шаг                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Эргономика         | Чтение и запись `store.state.invoices[id].customer.name`, normalized physical rows            | Membership-дефекты и identity-регрессии исправлены в эксперименте; следующий шаг — typed module на общем ядре                                          |
| Атомарность        | Одно пользовательское действие даёт один согласованный commit, rollback без промежуточного UI | Runtime имеет nested savepoints; normalized experiment пока запрещает nested actions. Не скрывать различие одинаковыми именами                         |
| Создание сущностей | Создание/связывание нескольких новых rows атомарно                                            | Runtime запрещает allocation графа внутри transaction. Интеграция требует явного протокола staged entity/graph ownership, не копирования двух runtimes |
| Snapshot           | Старый snapshot неизменяем, identity/structural sharing заданы явно                           | Runtime signal payload — caller-owned reference. Нельзя обещать глубокую immutable semantics простому `.get()`                                         |
| Async              | Старый/отменённый результат не публикуется; cancellation не маскирует committed error         | Реализован небольшой latest module; owner lifecycle/retry/cache/server effects остаются отдельными политиками                                          |
| Undo и remote      | Undo отменяет локальное намерение, не стирает чужую более новую правку                        | Следующий Excalidraw-derived fixture: remote-between-local-undo, gesture grouping, delete/resurrect, overlapping optimism; пока НЕ проверено           |
| FSM                | Общие commands/patches; допустимость переходов проверяется до publish                         | Нужны реальные booking/issue transitions, compile-time invalid event tests и persisted-state migration                                                 |
| Типы/валидация     | TS schema + generated validators, без ручного дублирования схемы                              | Тестовые validate callbacks — test doubles AOT boundary, не готовая интеграция typia                                                                   |
| Скорость           | Семантически одинаковый workload, end-to-end стоимость и baseline                             | Здесь correctness corpus без performance scoreboard; не заявлять быстрее vanilla/Wasm или80% bug prevention                                            |

## Воспроизводимый запуск

Из `packages/state-lib/site`:

```sh
node --import tsx ../runtime/examples/availability.ts
node --import tsx tools/real-app-runtime.check.mts
node --import tsx --test ../runtime/src/core.test.ts ../runtime/src/core.regression.test.ts ../runtime/src/core.followup.test.ts ../runtime/src/latest-task.test.ts ../runtime/src/app-contracts.test.ts
node_modules/.bin/tsc -p ../runtime/tsconfig.latest.json --noEmit
```

Регрессионные контракты нормализованной коллекции, из корня репозитория (исходные RED-контрпримеры сохранены и теперь проходят):

```sh
node --test packages/state-lib/experiments/real-apps/normalized-apps.check.mjs
```

Новый `.check.mts` автоматически входит в site unit inventory, а `.check.mjs` — в существующий отдельный Node experiment runner. Новые RED-сценарии нельзя исключать из него, иначе missing membership снова станет невидимой ошибкой.
Проверка исходного дерева 860dc64eb04c7dcd8dac9cf755ce46b21fa56c67 от 18 сентября: 95 runtime/app/adapter tests и 200 normalized/compiler tests прошли, strict async type project также прошёл. Исходные четыре дефекта исправлены, как и лишняя перестройка membership keys на field-only updates. Это не полный production-release и не прогон upstream приложений; отдельные группы не суммируются с перекрывающимися app-only gates.

## Ближайшая очерёдность

Завершено: четыре normalized membership/read-your-writes исправления, generation после aborted/net-zero create, 1200-step reference-board сравнение и кеширование состава таблицы. Следующий P0: перенести normalized identity/storage на общий typed transaction/notification контракт, сохраняя user-facing доступ без drafts(tx). P1: Excalidraw-local undo с interleaved remote edits и optimistic overlap. P1: реальный booking FSM/availability request key (event/date/duration/timezone/reservation), cleanup и ошибки подтверждения сервера. P2: generated schema, adapters/SSR, затем измеряемые performance baselines.
Каждый пункт завершает runnable scenario, regression/oracle, API decision и видимое объяснение на сайте. Не вводить ради красивого примера отдельный скрытый runtime или manual rescue-path, которого обычный пользователь не получит.
Сайт: отдельная полная матрица `SITE-REQUIREMENTS.md`; финальный v1-contract документировать после этих контрпримеров и явного согласования.
