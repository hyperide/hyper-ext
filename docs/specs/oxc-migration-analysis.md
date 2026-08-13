# OXC Migration Analysis — hyperide

> Создан: 2026-05-16  
> Цель: оценить целесообразность перехода на OXC (oxc.rs) вместо текущего стека

---

## Текущий инструментальный стек

| Инструмент                                 | Роль                                             | Конфиг          |
| ------------------------------------------ | ------------------------------------------------ | --------------- |
| `@biomejs/biome`                           | Lint + Format + Import sort                      | `biome.jsonc`   |
| `tsc`                                      | Type checking (noEmit)                           | `tsconfig.json` |
| `@swc/core`                                | Трансформация TS→JS (devDep, вероятно через Bun) | —               |
| `@babel/parser` + `traverse` + `generator` | AST-манипуляции в extension (code transforms)    | —               |
| `lefthook`                                 | Pre-commit: biome + tsc + custom script          | `lefthook.yml`  |

---

## OXC: что это и из чего состоит

OXC (The JavaScript Oxidation Compiler) — коллекция высокопроизводительных JS-инструментов на Rust. Каждый компонент независим.

| Компонент       | Статус (май 2026) | Описание                                |
| --------------- | ----------------- | --------------------------------------- |
| **Oxlint**      | ✅ Production     | Линтер, 785+ правил, ESLint-совместимый |
| **Oxfmt**       | 🔶 Beta           | Форматтер, Prettier-compatible          |
| **Parser**      | ✅ Production     | JS/TS парсер, 3× быстрее SWC            |
| **Transformer** | ✅ Production     | TS/JSX → ESNext, React Fast Refresh     |
| **Resolver**    | ✅ Production     | Node.js-совместимый резолвер модулей    |
| **Minifier**    | 🔴 Alpha          | Минификатор (не трогать)                |

---

## Сравнение по компонентам

### 1. Линтер: Biome → Oxlint

**Скорость:**

- Oxlint vs ESLint: 50–100× быстрее
- Oxlint vs Biome: **~2× быстрее**

**Правила:**

- Biome: ~200 curated правил
- Oxlint: 785+ правил, ESLint-совместимые плагины (react, typescript, import, unicorn, jsx-a11y)

**Поддержка наших правил из biome.jsonc:**

| Biome rule                  | Oxlint эквивалент                    | Статус                        |
| --------------------------- | ------------------------------------ | ----------------------------- |
| `noUnusedImports`           | `no-unused-vars` / typescript плагин | ✅                            |
| `noUnusedVariables`         | `no-unused-vars`                     | ✅                            |
| `noExplicitAny`             | `typescript/no-explicit-any`         | ✅                            |
| `useImportType`             | `typescript/consistent-type-imports` | ✅                            |
| `useConst`                  | `prefer-const`                       | ✅                            |
| `useTemplate`               | `prefer-template`                    | ✅                            |
| `useNodejsImportProtocol`   | `unicorn/prefer-node-protocol`       | ✅                            |
| `useExhaustiveDependencies` | `react-hooks/exhaustive-deps`        | ✅                            |
| `noVar`                     | `no-var`                             | ✅                            |
| `organizeImports`           | нет встроенного                      | ❌ нужен отдельный инструмент |

**Проблема:** Biome делает всё в одном (lint + format + import sort). Oxlint — только линтер. Нужно держать либо Oxfmt рядом, либо комбинировать.

**Config migration:** есть `@oxlint/migrate` для автоматической конвертации из ESLint конфига.

**Конфиг для нашего проекта (пример):**

```json
{
  "plugins": ["react", "typescript", "import", "unicorn"],
  "rules": {
    "no-unused-vars": "warn",
    "no-var": "error",
    "prefer-const": "error",
    "prefer-template": "error",
    "typescript/no-explicit-any": "warn",
    "typescript/consistent-type-imports": "error",
    "unicorn/prefer-node-protocol": "error",
    "react-hooks/exhaustive-deps": "warn"
  }
}
```

---

### 2. Форматтер: Biome → Oxfmt

**Скорость:**

- Oxfmt vs Prettier: >30× быстрее
- Oxfmt vs Biome: **~3× быстрее**

**Совместимость:** ~95% Prettier-совместимости. Biome тоже Prettier-совместим, так что переход должен быть безболезненным.

**Отличие:** Oxfmt по умолчанию `printWidth: 100` (у нас в biome `lineWidth: 120`). Настраивается.

**Статус:** Beta — не ломает код, но edge cases возможны. Для форматтера это приемлемо (всегда можно откатить).

**Важно:** Oxfmt поддерживает больше языков чем Biome: YAML, TOML, HTML, Vue, Markdown, MDX. Для нас несущественно прямо сейчас.

---

### 3. Type checker: tsc → ???

**OXC НЕ ЗАМЕНЯЕТ tsc для type checking.**

OXC transformer умеет стриппать типы (type stripping), но не проверяет их. Type checking — это отдельная сложная задача, требующая type inference и полного анализа программы.

Альтернативы tsc для type checking в 2026:

- **tsgo** (TypeScript 7, написан на Go) — 10× быстрее tsc, но ещё в разработке
- **tsc** — остаётся единственным production-ready type checker

**Вывод: tsc остаётся.** Его нельзя заменить ничем готовым к продакшену.

OXC transformer полезен для **сборки** (трансформация TS→JS), не для проверки типов. У нас Bun делает трансформацию сам, поэтому oxc-transform нам напрямую не нужен.

---

### 4. Трансформация: Babel → OXC Transformer

Это самый интересный кейс для нашего проекта.

**Текущее использование Babel:**

- `@babel/parser` — парсинг TS/JS кода в AST
- `@babel/traverse` — обход AST (code transforms в extension)
- `@babel/generator` — генерация кода из AST
- `@babel/types` — утилиты для работы с AST нодами

Это используется в **extension** для анализа и трансформации пользовательского кода (например, вставка i18n ключей, patch entry file для /test-preview).

**Может ли OXC заменить Babel AST pipeline?**

- OXC имеет JS API через `oxc-parser` (npm пакет)
- Но: OXC AST **не совместим** с Babel AST — разная схема нод
- Трансформации через OXC делаются через Rust API (Visitor pattern) — не через JS
- JS API у OXC: parse → получаешь AST, но трансформировать и генерировать код через JS нельзя напрямую (это Rust-уровень)
- **Вывод: Babel для AST манипуляций заменить OXC-ом нельзя без переписывания на Rust**

Recast + Babel — единственный зрелый JS-доступный pipeline для code transforms. Можно рассмотреть **ts-morph** как более TypeScript-нативную альтернативу, но это другая история.

---

### 5. SWC в проекте

`@swc/core` в devDependencies вероятно используется Bun's test runner или каким-то плагином. Bun 1.x использует собственный JS engine (JavaScriptCore), но SWC для некоторых трансформаций. OXC не нужен как замена — Bun сам решает когда переключаться.

---

## Итоговая матрица рекомендаций

| Компонент         | Сейчас           | Переход на OXC       | Рекомендация                                                |
| ----------------- | ---------------- | -------------------- | ----------------------------------------------------------- |
| **Lint**          | Biome            | Oxlint               | 🟡 Возможно, но ~2× выигрыш небольшой при уже быстром Biome |
| **Format**        | Biome            | Oxfmt                | 🟡 Beta, 3× выигрыш, но Biome уже достаточно быстр          |
| **Lint + Format** | Biome (one tool) | Oxlint + Oxfmt (два) | 🔴 Теряем простоту монолитного инструмента                  |
| **Type check**    | tsc              | tsc (нечем заменить) | ✅ Оставить как есть                                        |
| **TS transform**  | Bun built-in     | OXC transformer      | 🔴 Не нужно — Bun сам справляется                           |
| **Babel AST**     | @babel/\*        | нельзя (разные AST)  | ✅ Оставить как есть                                        |
| **Import sort**   | Biome assist     | нет в Oxlint         | 🔴 Потеряем фичу при уходе от Biome                         |

---

## Стратегия: что реально имеет смысл

### Вариант A: Ничего не менять (статус кво)

**Аргументы:**

- Biome уже быстрый, нет боли которую нужно решать
- Монолитный инструмент (lint + format + sort) — меньше конфигов
- Biome 2.x активно развивается, dogfoods OXC парсер внутри
- Нет миграционных рисков

### Вариант B: Добавить Oxlint рядом с Biome

**Аргументы:**

- Oxlint покрывает больше правил (785 vs 200)
- Можно получить доп. линтинг без замены форматтера
- Официально рекомендованный путь: Oxlint + Biome formatter
- Риск: два конфига, возможные конфликты правил

**Реализация:**

```bash
bun add -d oxlint
# Запускать рядом: biome format + oxlint check
```

### Вариант C: Полная замена Biome на Oxlint + Oxfmt (когда Oxfmt stable)

**Аргументы:**

- Максимальная скорость (2-3× vs Biome)
- Больше lint правил
- Лучшая ESLint совместимость (легче копировать правила из экосистемы)

**Проблемы:**

- Oxfmt пока Beta (декабрь 2025 — ?)
- Потеря import organizer (нужно что-то отдельное)
- Два конфига вместо одного
- Риск расхождений в форматировании при edge cases

---

## Когда смотреть снова

- **Oxfmt Stable**: сигнал для полной миграции с Biome
- **tsgo (TypeScript 7) production**: может ускорить type checking в 10×
- **OXC JS Transform API**: если появится полноценный JS API для code transforms (тогда можно рассматривать замену Babel AST pipeline)

---

## Конкретные следующие шаги (если хочешь двигаться)

1. **Сейчас (низкий риск):** добавить Oxlint как дополнительный линтер поверх Biome. Ловит больше проблем. Команда: `oxlint ./client/ ./lib/ ./server/ ./shared/`

2. **После Oxfmt stable (~Q2 2026):** замерить форматирование нашей кодовой базы, сравнить output. Если diff чистый — мигрировать.

3. **tsc:** не трогать. Следить за tsgo.

4. **Babel:** не трогать. Нет готовой замены для JS-уровня AST transforms.

---

## Источники

- [OXC Homepage](https://oxc.rs/)
- [Oxlint docs](https://oxc.rs/docs/guide/usage/linter.html)
- [Oxfmt Beta announcement](https://oxc.rs/blog/2025-12-01-oxfmt-alpha.html)
- [Biome vs OXC 2026 comparison](https://www.pkgpulse.com/guides/biome-vs-oxc-2026)
- [OXC Benchmarks](https://oxc.rs/docs/guide/benchmarks)
- [Faster Type-Aware Lint Rules: Biome vs Oxlint](https://www.solberg.is/fast-type-aware-linting)
- [OXC Transformer docs](https://oxc.rs/docs/guide/usage/transformer)
