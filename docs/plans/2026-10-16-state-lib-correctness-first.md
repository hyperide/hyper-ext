# State-lib: correctness-first — план реализации

> **Для агента:** выполнять задачи последовательно через
> `superpowers:executing-plans`
> или `superpowers:subagent-driven-development`. Изменения поведения проходят
> RED → GREEN.
> Чекбокс означает проверенный результат, а не намерение.

**Дата:** 16 октября 2026 года.
**Goal:** устранить повторяющиеся гонки библиотечными гарантиями, защитить
пользовательский
ввод, сократить прикладной код и стоимость обновления интерфейса.
**Architecture:** существующее реактивное ядро + общий слой полномочий операций
и обратной
связи + draft/bind + тонкий React-адаптер. Существующий writer остаётся
единственным
владельцем записи, проверки применения, отката и журнала документа.
**Tech Stack:** TypeScript, текущие Runtime/latestTask/createAsyncResource,
React,
Bun и Node test runner. Первый этап не добавляет зависимостей.
**Spec:** согласованное направление из беседы и разделы 4.15, 4.16, 6, 11–12
[master
spec](https://github.com/hyperide/hyper-saas/blob/638be9a371e95e4ec95edefcec7b863e020a361b/packages/state-lib/docs/2026-09-01-state-master-spec.md).
Контракт первого этапа конкретизирован ниже.
**Задачи:** [HYP-1507](https://tasks-ultrabricks.vercel.app/tasks/HYP-1507) —
общий toolkit;
[HYP-1536](https://tasks-ultrabricks.vercel.app/tasks/HYP-1536) — Style Editor
pilot.

## 1. Основание

В [пилоте #824](https://github.com/hyperide/hyper-saas/pull/824) заменили 50
вызовов
состояния, но оставили прежнее владение запросами и побочными действиями.
[Отчёт](https://github.com/hyperide/hyper-saas/blob/638be9a371e95e4ec95edefcec7b863e020a361b/docs/reports/2026-10-14-style-state-pilot.md)
фиксирует отсутствие доказанного выигрыша ввода, +268 строк интеграции и +3 269
байт
gzip изолированного стенда. Три поздние ошибки остаются красными в обоих
вариантах:
после новой записи, смены выделения и перемонтирования. Это исторический замер.

Гипотеза следующего этапа: библиотека принесёт пользу, если возьмёт на себя
повторяемые
гарантии операций и черновиков, а не только хранение значений. Ускорение и
успешное
принятие технологии не обещаются до новых измерений.

## 2. Global Constraints

- Старый пилот и его evidence не переписывать. Новый опыт получает отдельную
  ветку.
- Не строить второй
  SelectionStyleRead/planner/VTSWR/AST/HMR/rollback/undo/journal.
- Сохранить владельцев [PR
  #805](https://github.com/hyperide/hyper-saas/pull/805) и
  [HYP-1588](https://tasks-ultrabricks.vercel.app/tasks/HYP-1588): не
  cherry-pick и
  не копировать их предметную логику под видом библиотечного улучшения.
- [Draft #813](https://github.com/hyperide/hyper-saas/pull/813) не объявлять
  утверждённым
  adoption gate. Три текущих failing assertions не ослаблять.
- Работа только в отдельном worktree; main pull-only. Чужие процессы и изменения
  не трогать.
- Общий слой framework-neutral, без глобального singleton со значениями
  приложения.
- Транзакция синхронна. UI-полномочия, выполнение запроса и результат внешней
  записи различны.
- Актуальные ошибки остаются видимыми. Отмена UI не доказывает отмену или откат
  записи.
- Persistence и отправка диагностик только при явном подключении, без
  чувствительных полей.
- Не выполнять merge, deploy, публикацию npm или широкую миграцию. Не отправлять
  Slack/email/Telegram. Публикация feature-ветки допускается только после
  обычных gates.
- Не обходить review, hooks или полный runner через GitHub API. Lefthook
  запускать с
  `--no-auto-install`: это запрещает побочную установку hooks, но не выполнение
  checks.

## 3. Первый срез: полномочия операции

`createOperationScope` — небольшой слой разрешения синхронной публикации и
UI-обратной
связи после await. Это не альтернативный scheduler: запуск и отмена асинхронной
работы
остаются у `latestTask` или существующего writer.

```ts
type OperationLane = string | symbol;
type RevocationReason =
  | 'superseded' // A newer operation owns this lane.
  | 'scope-changed'
  | 'scope-disposed'
  | 'cancelled'
  | 'finished';
type Sync<T> = T extends PromiseLike<unknown> ? never : T;
type GateResult<T> =
  | { readonly status: 'applied'; readonly value: T }
  | { readonly status: 'dropped'; readonly reason: RevocationReason };

interface OperationLease {
  readonly id: number;
  readonly generation: number;
  readonly current: boolean;
  commit<T>(fn: () => T & Sync<T>): GateResult<T>;
  notify<T>(fn: () => T & Sync<T>): GateResult<T>;
  bind<Args extends unknown[], T>(
    // Every later call checks authority again with these argument types.
    fn: (...args: Args) => T & Sync<T>,
  ): (...args: Args) => GateResult<T>;
  finish(): void;
  cancel(): void;
}
interface OperationScope {
  begin(lane: OperationLane): OperationLease;
  advance(): void;
  dispose(): void;
  diagnostics(): OperationDiagnostics;
}
// createOperationScope(runtime, { traceCapacity?: number }): OperationScope
```

### Поведенческий контракт

1. `begin` заменяет только активный запуск той же lane. Независимые lane
   сохраняются.
   Какие операции конфликтуют, определяет writer, а не библиотечная догадка.
2. `advance` безусловно открывает новое поколение. A → B → A не оживляет первую
   A.
3. `dispose` отзывает все UI-полномочия; повторный dispose безвреден.
4. `commit` проверяет полномочия и выполняет одну транзакцию Runtime. Старый
   callback
   не вызывается; возвращается `dropped` с причиной.
5. `notify` проверяет полномочия перед синхронным вызовом обратной связи вне
   транзакции.
   Исключение актуального обработчика не проглатывается.
6. Старый `finish/cancel` не освобождает слот следующего запуска. Scope хранит
   только
   активные слоты, а не все исторические операции.
7. Изменение полномочий внутри transaction/derivation/notification Runtime
   запрещено.
   Отказ сохраняет прежнее поколение, активные операции и diagnostic snapshot.
8. Порядок закрытия: scope перед Runtime. Поздний callback уже отозванной
   операции
   после обоих закрытий возвращает `dropped`, не создавая новую ошибку или
   запись в trace.
   Действующий lease с нарушенным порядком закрытия Runtime получает явный
   отказ.
9. Scope не отменяет внешний writer. Поздний outcome остаётся у владельца
   документа
   для согласования, хотя старому интерфейсу его показывать уже нельзя.

`current` — advisory snapshot, не разрешение переносить результат проверки через
await.
Использовать `commit/notify` в момент публикации. Сырой Runtime и произвольные
callbacks
в обход API не перехватываются: это контракт программирования, не security
sandbox.
Async callbacks запрещены типами; JS misuse должен получить явный отказ.
Проверка
возвращённого Promise не может отменить побочный эффект, уже начатый таким
callback.

### Причинный журнал

По умолчанию `traceCapacity=0`: запись выключена. При включении ёмкость — целое
1…4096;
сохраняются последние N событий и счётчик вытеснений. Диагностика возвращает
frozen copy.

`OperationDiagnostics`: generation, disposed, activeOperations, droppedEvents,
trace.
Событие: sequence, generation, operationId, kind, reason и published для failed
commit.
Виды: begin/revoke/advance/dispose, commit/notify, drop-commit/drop-notify,
commit-failed/notify-failed. Sequence монотонен внутри scope.

Не записывать lane, документ, значения полей, сообщения исключений или stack
traces.
Различать ошибку до публикации и ошибку observer после неё по факту публикации
Runtime,
а не только по классу NotificationError. Полный record/replay — следующий этап.

## 4. Review Focus

- A → B → A, независимые lane, два отдельных scope на одном Runtime.
- Старый cleanup после нового запуска не завершает следующую операцию.
- Ошибка callback до публикации против observer failure после неё, включая throw
  undefined.
- Reentrant notify, закрытие между commit и notify, отказ в
  derivation/notification.
- Рост долгоживущего владельца, переполнение trace, отсутствие private content в
  diagnostic copy.

Все эти классы должны иметь исполнимые регрессии, не только ручное review.

## 5. Задачи первого вертикального среза

### Задача 1. OperationScope и ограниченный trace

**Files:** создать `packages/state-lib/toolkit/src/operation-scope.ts`,
`operation-scope.test.ts`, `operation-scope.types.fixture.ts`.
**Consumes:** текущие Runtime/StateError через существующий runtime barrel.
**Produces:** интерфейсы раздела 3. Ядро не меняется; npm/public export пока не
заявляется.

- [ ] Написать RED: current commit; supersession; независимые lane; ABA;
      dispose;
      old finish; stale feedback и положительный контроль актуальной ошибки.
- [ ] Реализовать минимальный scope без второго async scheduler.
- [ ] Добавить RED → GREEN для неправильных trace options, JS callback misuse,
      purity/transaction/notification boundaries, ошибок до/после commit и
      teardown.
- [ ] Проверить неизменяемость trace и 10 000 begin/finish при долгоживущем
      scope.
- [ ] Проверить TypeScript: async callback и неверный тип lane/результата
      отклоняются.
- [ ] Negative control: временно убрать guard в изолированной копии — прежние
      ошибки
      возвращаются. Восстановить исходник и получить GREEN без смены assertions.
- [ ] Прогнать formatter/lint/knip, root и toolkit typecheck, полный `bun run
test`, review-cli.
- [ ] Commit только после обычных gates; source-only стадию не выдавать за
      package acceptance.

На рабочем хосте focused command:
`bun test packages/state-lib/toolkit/src/operation-scope.test.ts`.
Expected: все зарегистрированные тесты проходят, failures=0, есть полный
summary.
Переносимый Node runner допустим для отдельного раннего эксперимента, но не
заменяет
полный Bun runner проекта.

### Задача 2. Композиция с существующим latestTask

**File:** `packages/state-lib/toolkit/src/operation-scope-async.test.ts`.
**Consumes:** неизменённый latestTask и OperationScope задачи 1.
**Produces:** библиотечные регрессии трёх классов поздней UI-ошибки.

- [ ] Воспроизвести старый catch writer после новой записи, смены контекста и
      unmount.
- [ ] Проверить: stale feedback не вызывается, актуальная ошибка видна ровно
      один раз.
- [ ] Проверить: внешние success/failure не исчезают из outcome владельца
      документа.
- [ ] Проверить committed result → queued continuation → смена контекста.
- [ ] Проверить latestTask cancel с non-cooperative loader: prompt cancellation
      не означает
      отмену внешнего side effect. Старый finally не завершает новый lease.
- [ ] Запустить обе новые test suites и существующие runtime/toolkit regression
      suites.

Deferred promises здесь заменяют транспорт, но не Runtime. Эти тесты не
доказывают
live AST/HMR, видимое окно AI-панели или фактический откат документа.

### Задача 3. Подключение к поддерживаемому API и одному полю Hyper

**Files:** после проверки свежей базы — toolkit barrel/build/export-contract
tests,
общий `client/components/RightSidebar/hooks/useStyleSync.ts`, conformance и
browser scenarios.

- [ ] Прочитать актуальные #805/HYP-1588/HYP-1507 и определить общий baseline
      без дублирования.
- [ ] Встроить scope в effect/command-контракт так, чтобы приложение не
      повторяло guards
      в каждом catch/finally. Различить lifetime панели и lifetime операции
      документа.
- [ ] Добавить public export и offline install-from-artifact test; проверить
      один общий Runtime,
      tree-shaking и отсутствие deep src-импортов в итоговом consumer artifact.
- [ ] Подключить один полный сценарий изменения ширины, сохранив существующий
      writer.
- [ ] Повторить три неизменённых safety assertions и контроль актуальной ошибки.
- [ ] Проверить настоящий extension host и SaaS путь, сохранить screenshots и
      exact source hashes.

## 6. Следующие самостоятельные этапы

### Задача 4. Защищённый draft/bind

Source, draft и sent revision различны. Ack старых `130px` не очищает новые
`140px`;
старое чтение `120px` не уничтожает ввод `12p`; ошибка сохраняет намерение и
retry/discard.

- [ ] Зафиксировать отдельный контракт и tests до реализации нового API.
- [ ] Проверить stale read, reordered ack, смену target, retry, conflict и
      сохранность draft.
- [ ] Различить incomplete/invalid, сохранить IME/caret/keyboard-only.
- [ ] Persistence подключается явно; password/sensitive не сохраняются.

### Задача 5. UI-overlay без второго rollback/journal

- [ ] Удалять слой своей операции, не восстанавливать слепой старый snapshot.
- [ ] Проверить A:120→130, B:130→140, B confirmed, A failed — итог остаётся 140.
- [ ] Domain rollback/undo по-прежнему принадлежит writer; retry не создаёт
      второе намерение.

### Задача 6. Точечный React-binding и второй потребитель

- [ ] Подписка у поля/секции, а не корня панели на все значения; стабильные
      snapshots/actions.
- [ ] Связанные изменения публикуются атомарно; draft отображается сразу,
      debounce — для отправки.
- [ ] Проверить StrictMode, child layout, remount и churn детей при долгоживущем
      provider.
- [ ] Не обещать полную useState-семантику для
      render-phase/Transition/Suspense/SSR без тестов.
- [ ] Подключить тот же контракт к редактированию заголовка в Tasks в отдельном
      worktree.
- [ ] Посчитать удалённые app guards/effects/copies и полную стоимость нового
      library glue.

### Задача 7. Record/replay и новый adoption gate

- [ ] Записывать необходимые команды, ответы, отмены, таймеры и source/schema
      versions.
- [ ] Воспроизводить в sandbox без повторного выполнения реальных внешних
      записей.
- [ ] Генерировать перестановки событий; уменьшать найденный failure до
      regression sequence.
- [ ] Инъецированная гонка должна давать объяснение причины и воспроизводимый
      тест без private data.
- [ ] До замера установить числовые бюджеты latency/bundle/heap/LOC. Пока они не
      согласованы,
      технически законченный эксперимент не объявляется GO.
- [ ] Сравнить одинаково исправленный writer и одинаковые границы UI в обоих
      вариантах.
- [ ] Разделить вклад общей app-починки и библиотеки; старый NO-GO задним числом
      не менять.

## 7. Определение успеха

**Надёжность:** известные гонки проходят, актуальные ошибки видны, новый ввод не
стирается
старым ack/rollback; negative controls показывают вклад библиотечного механизма.

**Сложность:** отдельно считаются прикладной код, общий библиотечный код и
суммарный
integration cost. Перенос строк в другую директорию не считается выигрышем.

**Производительность:** фиксируются focused latency, render scope, heap после
GC,
готовый пакет и consumer bundle. Бюджеты задаются до опыта. Устранение классов
багов может
обосновать внедрение без большого ускорения, но не без заранее согласованной
цены.

**Диагностика:** ошибка превращается в связанную цепочку причин и
воспроизводимый тест,
а не только конечное значение и разрозненные логи.

## 8. Рабочее состояние

Пользователь явно поручил сохранить план и начать работу. Первый независимый
срез —
задачи 1–2; задачи 3–7 остаются последующими этапами, а не молча отброшенным
объёмом.

При начальной недоступности рабочего хоста библиотечный эксперимент выполнялся
на
изолированном source snapshot. После восстановления связи создан worktree:
`/home/ultra/work/hyper-canvas-draft-worktrees/state-operation-authority-20261016`,
ветка `feat/HYP-1507-operation-authority-20261016`, от актуального `origin/main`
`da611247987cc6b2fbb955857e4cc6f9d1410f8e`.

Git blob SHA четырёх использованных runtime-файлов совпали с исходниками старого
пилота.
Lockfiles не меняются. На рабочем хосте все подтверждения снимаются заново;
ранние локальные
результаты не подменяют полный runner и review. Фактическое исполнение и
отклонения
фиксируются в отдельном progress ledger. Merge/deploy и broad adoption не входят
в старт.
