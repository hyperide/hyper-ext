Date: 2026-04-01
Author: Alex Ultra
Status: Pass 1 — Research Complete
Related: ds-core-design.md, ai-test-design.md, component-stage-design.md, mock-server-design.md

# Аналоги "self-improving decision template system"

Исследование охватывает системы, где AI принимает решения → решения кристаллизуются в шаблоны → человек проверяет → шаблоны работают автоматически → AI вызывается только как fallback → система становится всё более детерминированной.

> Research current as of April 2026. Landscape evolves — revisit annually.

## Наша система

**Self-improving decision template system** для валидации design system.

AI-решения кристаллизуются в детерминированные шаблоны (templates) с human review. Шаблоны накапливаются, и со временем система переходит из AI-режима в детерминированный — AI вызывается всё реже, шаблоны обрабатывают всё больше кейсов.

Система используется в 4 пакетах:
- **DS Core** — движок линтера design system правил
- **AI Test Runner** — визуальное тестирование с AI-оценкой
- **Component Stage** — playground для компонентов с валидацией
- **Smart Mock Server** — HTTP mocking с шаблонами ответов

Шаблоны хранятся в shared `TemplateStore`, матчатся через DSL `when`-выражения.

Трёхуровневая валидация:
1. **Algorithmic** — детерминированные проверки (spacing, contrast ratios)
2. **Template** — накопленные шаблоны из прошлых AI-решений
3. **AI fallback** — полный AI-вызов, только когда шаблон не найден

Template shortcuts AI calls — это ключевой механизм экономии.

> Детальная архитектура: `2026-04-01-ds-core-design.md` Section 5-6, 13.

---

## PRE-AI ERA

### 1. Case-Based Reasoning (CBR)

**Что это.** Методология решения новых задач путём адаптации ранее успешных решений похожих задач. Работает через цикл 4R: Retrieve → Reuse → Revise → Retain.

**Сходство.** Ядро идеи совпадает: система решает новую задачу, сохраняет решение, и в будущем переиспользует его для похожих кейсов. Чем больше решённых кейсов в базе — тем реже нужна "сложная" работа.

**Различие.** CBR адаптирует старые решения, а не генерализует их в шаблоны. Нет явной фазы "человек утверждает шаблон" — кейсы добавляются как есть. И нет перехода из ML-режима в детерминированный: CBR всегда работает через similarity search.

**Уроки.** Проблема retrieval quality критична: плохой поиск похожих кейсов = плохие решения. Стоит инвестировать в качественный matching, а не только в генерацию шаблонов. Также CBR показал что "кейс-библиотека" со временем деградирует без maintenance — нужна стратегия pruning/review.

See also: §15 (Semantic Caching) — оба основаны на similarity retrieval.

Sources: [Case-based reasoning — Wikipedia](https://en.wikipedia.org/wiki/Case-based_reasoning), [CBR for CBR — ResearchGate](https://www.researchgate.net/publication/220831856_GonzalezCalero_CBR_for_CBR_A_Case-Based_Template_Recommender_System_for_Building_Case-Based_Systems)

---

### 2. Expert Systems + Knowledge Acquisition Bottleneck (MYCIN и др.)

**Что это.** Rule-based системы (MYCIN, DENDRAL) где знание экспертов кодировалось вручную в IF-THEN правила. MYCIN имел ~600 правил для диагностики инфекций.

**Сходство.** Цель та же: кодифицировать экспертные решения в детерминированные правила. MYCIN показал что 600 правил могут работать на уровне специалистов. Наша система автоматизирует то, что в MYCIN делали knowledge engineers вручную.

**Различие.** Главная боль expert systems — knowledge acquisition bottleneck. Знания извлекались из экспертов через интервью, что было мучительно долгим. В нашей системе AI заменяет этот bottleneck, генерируя "черновики правил" автоматически.

**Уроки.** Expert systems провалились не из-за плохой идеи правил, а из-за стоимости их создания и поддержки. Если наша система решает проблему acquisition автоматически — это устраняет главную причину провала. Но остаётся проблема maintenance: правила устаревают, конфликтуют, взаимодействуют непредсказуемо. Нужен механизм conflict detection и deprecation.

See also: §17 (NeMo Guardrails) — оба используют декларативные правила.

Sources: [MYCIN — Britannica](https://www.britannica.com/technology/MYCIN), [Knowledge Acquisition Bottleneck — AISNET](https://aisel.aisnet.org/icis1987/33/)

---

### 3. Ripple-Down Rules (RDR) — **САМЫЙ БЛИЗКИЙ АНАЛОГ**

**Что это.** Система инкрементального построения knowledge base, где эксперт добавляет/исправляет правила прямо во время работы с реальными кейсами. Разработана как ответ на maintenance-проблему expert systems.

**Сходство.** Почти идентичная архитектура: (1) система выдаёт решение, (2) если решение неправильное — эксперт добавляет/корректирует правило, (3) новое правило применяется к будущим похожим кейсам, (4) система становится всё точнее со временем. В реальном медицинском лабораторном применении за 29 месяцев было добавлено 16,000+ правил и обработано 6,000,000 кейсов.

**Различие.** В RDR человек-эксперт сам формулирует правило (условие → заключение). В нашей системе AI генерирует черновик правила, а человек только approve/reject/edit. Это существенно снижает когнитивную нагрузку на эксперта.

**Уроки.** RDR доказал что инкрементальное добавление правил "на ходу" — жизнеспособная стратегия. Ключевые находки: (a) правила должны быть привязаны к конкретному кейсу-провокатору (cornerstone case), иначе эксперт не помнит зачем правило было создано; (b) exception-based structure (правило + исключение + исключение-из-исключения) работает лучше flat list; (c) knowledge acquisition и maintenance — одно и то же действие, а не два отдельных процесса.

See also: §9 (RETE/Drools) — оба инкрементальные rule systems.

Sources: [Ripple-down rules — Wikipedia](https://en.wikipedia.org/wiki/Ripple-down_rules), [Two decades of RDR research — Cambridge](https://www.cambridge.org/core/journals/knowledge-engineering-review/article/abs/two-decades-of-ripple-down-rules-research/53F5A74019BF784212E32E0EFF965149)

---

### 4. Explanation-Based Learning (EBL) / Knowledge Compilation

**Что это.** Метод обучения, при котором система наблюдает один пример, объясняет ПОЧЕМУ он является экземпляром концепта, и превращает объяснение в операциональное правило для быстрого распознавания в будущем. Также называется "speedup learning" или "operationalization".

**Сходство.** Прямой концептуальный аналог: система уже "знает" как решать задачу (через AI), но это знание неоперационально (дорогое). EBL/compilation превращает его в быстрое детерминированное правило. Как и в нашей системе, со временем всё больше кейсов покрыто "скомпилированными" правилами и всё меньше требуют полного reasoning.

**Различие.** EBL автоматическое — нет фазы human review. Также EBL работает с формальной domain theory (набором аксиом), а не с neural network.

**Уроки.** EBL показал проблему utility problem: если скомпилированных правил слишком много, их matching может стать дороже оригинального reasoning. Нужен механизм оценки "окупаемости" каждого шаблона (frequency of use vs cost of matching).

Sources: [EBL — Wikipedia](https://en.wikipedia.org/wiki/Explanation-based_learning), [EBL Survey — ACM](https://dl.acm.org/doi/10.1145/66443.66445)

---

### 5. SOAR Chunking / PRODIGY Macro-Operators

**Что это.** SOAR — cognitive architecture, где "chunking" автоматически компилирует результаты проблем-решений в production rules для будущего использования. PRODIGY — аналог с macro-operators (цепочки действий, сохранённые как один оператор).

**Сходство.** Chunking в SOAR — это буквально "AI решает задачу → результат кристаллизуется в deterministic rule → rule применяется автоматически в будущем". Macro-operators в PRODIGY — "AI планирует цепочку шагов → цепочка сохраняется как шаблон".

**Различие.** Полностью автоматический процесс без human review. Rules генерируются из trace выполнения, а не из решения AI модели.

**Уроки.** SOAR обнаружил что chunking может создавать overly-specific правила (привязанные к конкретному контексту) или overly-general (срабатывающие там где не надо). Нужен баланс специфичности шаблонов. Также показал что hierarchical decomposition помогает: chunk на уровне подзадачи полезнее чем на уровне атомарного шага.

Sources: [Chunking in Soar — Springer](https://link.springer.com/article/10.1007/BF00116249), [PRODIGY — CMU](https://www.cs.cmu.edu/~jgc/publication/Integrating_Planning_Learning_PRODIGY_JETAI_1995.pdf)

---

### 6. Decision Tree Induction (C4.5, RIPPER)

**Что это.** Алгоритмы, которые автоматически извлекают IF-THEN правила из данных. C4.5 строит дерево, затем конвертирует ветки в правила. RIPPER строит правила напрямую через sequential covering.

**Сходство.** Автоматическое извлечение детерминированных правил из наблюдений. Правила человекочитаемые и могут быть отредактированы экспертом.

**Различие.** Работают с табличными данными и статистикой, не с LLM-решениями. Нет incremental learning — переобучение на полном датасете. Нет workflow "AI → template → human review".

**Уроки.** RIPPER показал что правила, построенные напрямую (direct method), часто компактнее и точнее чем извлечённые из деревьев (indirect method). Для нашей системы: лучше генерировать шаблон напрямую из AI-решения, чем пытаться "дистиллировать" паттерн из множества решений.

Sources: [RIPPER — William Cohen](https://crystal.uta.edu/~gonzalez/ml/Ripper.pdf), [Rule Induction — ScienceDirect](https://www.sciencedirect.com/topics/computer-science/rule-induction)

---

### 7. Inductive Logic Programming (ILP)

**Что это.** Подобласть AI, которая индуктивно строит логические программы (first-order clausal theories) из примеров и фонового знания.

**Сходство.** Генерирует правила из примеров, правила человекочитаемые и проверяемые. Muggleton показал "ultra-strong ML" — когда выученные правила улучшают производительность человека (не только машины).

**Различие.** Требует формализации в логике первого порядка. Вычислительно дорогое. Нет workflow с human-in-the-loop approval.

**Уроки.** ILP подтвердил что interpretability правил — не баг, а фича. Когда человек может прочитать и понять правило, он может его улучшить. Наша система должна генерировать максимально читаемые шаблоны.

Sources: [ILP — Wikipedia](https://en.wikipedia.org/wiki/Inductive_logic_programming), [ILP at 30 — Springer](https://link.springer.com/article/10.1007/s10994-021-06089-1)

---

### 8. Programming by Example / Programming by Demonstration (Microsoft PROSE/FlashFill)

**Что это.** Системы, которые синтезируют программы из примеров input-output. FlashFill в Excel — пользователь показывает 1-2 примера преобразования строк, система генерирует программу для всех строк.

**Сходство.** AI видит примеры → генерализует в программу (шаблон) → программа применяется автоматически. Пользователь может проверить результат и дать ещё примеров если генерализация неверная.

**Различие.** PBE работает в узком домене (string transformations, data wrangling). Нет накопления библиотеки шаблонов — каждый раз с нуля. Нет human approve/reject workflow.

**Уроки.** PROSE показал что ranked set of programs (несколько вариантов генерализации) работает лучше одного — пользователь может выбрать правильную интерпретацию. Для нашей системы: предлагать несколько вариантов шаблона, а не один.

Sources: [PROSE — Microsoft Research](https://www.microsoft.com/en-us/research/group/prose/), [FlashFill — Sumit Gulwani](https://www.microsoft.com/en-us/research/people/sumitg/)

---

### 9. Business Rule Engines (Drools / RETE Algorithm)

**Что это.** Системы для выполнения бизнес-правил. RETE — эффективный алгоритм pattern matching для правил. Drools — Java-based BRMS с forward/backward chaining.

**Сходство.** Правила декларативные, человекочитаемые, выполняются детерминированно. Система логирует какие правила сработали и почему (explanation facility). Правила могут добавляться incremental.

**Различие.** Правила пишутся людьми вручную — нет автоматической генерации из AI-решений. Нет fallback на AI когда правило не найдено.

**Уроки.** RETE показал что эффективный matching (через delta evaluation — только проверяя изменения) критичен при большом количестве правил. Наша система должна иметь эффективный template matching, а не перебор всех шаблонов. Также Drools показал ценность conflict resolution strategies — когда несколько шаблонов матчатся, нужна стратегия приоритезации.

See also: §3 (RDR) — оба инкрементальные rule systems.

**Наш подход (RETE-inspired, не full RETE):**

Полная RETE-сеть (beta nodes, token propagation, join nodes) — overkill. Наши шаблоны имеют в основном single-fact conditions, а не complex multi-fact joins. Берём ДВЕ идеи из RETE:

1. **Alpha memory как TemplateIndex** — `Map<ruleId, Map<propertyKey, Template[]>>` для O(1) lookup вместо O(n) linear scan в `findMatching()`.
2. **Incremental invalidation** — при изменении файла инвалидировать только шаблоны, чьи input patterns совпадают с изменёнными файлами, а не перевычислять все.

**Formalized conflict resolution algorithm** (из уроков Drools):
- `specificityScore` = количество условий в `when` expression
- `recencyScore` = нормализованный `lastAppliedAt` timestamp
- `frequencyScore` = нормализованный `applyCount`
- `finalScore = 0.5 * specificity + 0.3 * recency + 0.2 * frequency`
- Выбирается шаблон с наивысшим `finalScore`

Это даёт 90% пользы RETE при 10% сложности.

Sources: [Rete algorithm — Wikipedia](https://en.wikipedia.org/wiki/Rete_algorithm), [Drools Documentation](https://docs.drools.org/latest/drools-docs/drools/rule-engine/index.html)

---

### 10. Version Space Learning (Mitchell)

**Что это.** Алгоритм, который поддерживает множество гипотез (version space), совместимых с примерами. Сужает множество через generalization и specialization при каждом новом примере.

**Сходство.** Инкрементальное уточнение "что является правильным шаблоном" через примеры. С каждым новым кейсом шаблон становится точнее.

**Различие.** Чисто математический framework, нет человека в цикле. Работает с бинарными концептами, не с произвольными решениями.

**Уроки.** Version space algebra показала как композировать простые шаблоны в сложные. Для нашей системы: шаблоны должны быть composable (шаблон A + шаблон B = шаблон C для комплексных кейсов).

Sources: [Version Space Algebra — University of Washington](https://homes.cs.washington.edu/~pedrod/papers/mlc00c.pdf), [Version space learning — Wikipedia](https://en.wikipedia.org/wiki/Version_space_learning)

---

### 11. Active Learning with Oracle

**Что это.** ML-модель сама выбирает какие примеры отдать человеку (oracle) на разметку — те, в которых модель наименее уверена. Цикл: модель предсказывает → выбирает uncertain cases → человек размечает → модель дообучается.

**Сходство.** AI работает автономно на "уверенных" случаях, а человека привлекает только для неопределённых. Со временем уверенных случаев всё больше. Прямая параллель с "AI fallback only when no template matches".

**Различие.** В active learning модель дообучается (изменяет веса), а не создаёт отдельные deterministic rules. Человек даёт labels, а не approve/reject rules.

**Уроки.** Стратегия uncertainty sampling (отправлять человеку самые неуверенные кейсы) — работает, но не всегда оптимальна. Иногда лучше diversity sampling (покрывать разные области пространства). Для нашей системы: приоритезировать создание шаблонов не только для частых кейсов, но и для "покрытия" разнообразных ситуаций.

Sources: [Active Learning — Wikipedia](https://en.wikipedia.org/wiki/Active_learning_(machine_learning)), [Efficient HITL Active Learning — arXiv](https://arxiv.org/abs/2501.00277)

---

### 12. TRIZ (Теория Решения Изобретательских Задач)

**Что это.** Методология, основанная на анализе 2+ миллионов патентов: Альтшуллер обнаружил что ~95% инженерных проблем уже решены в других областях, и формализовал 40 изобретательских принципов + матрицу противоречий.

**Сходство.** Концептуально идентичная идея: решения → анализ паттернов → шаблоны (принципы) → применение шаблонов к новым задачам. TRIZ — это ручная, человеческая версия нашей системы: люди (а не AI) изучали решения, выделяли паттерны, и кодифицировали их в reusable templates.

**Различие.** Создание шаблонов было одноразовым исследовательским проектом, а не continuous loop. Нет автоматического matching "задача → принцип".

**Уроки.** TRIZ показал что abstraction level шаблона критичен. 40 принципов работают потому что они на правильном уровне абстракции — не слишком конкретные (иначе их было бы миллионы) и не слишком общие (иначе бесполезны). Наша система должна находить этот sweet spot для каждого шаблона.

Sources: [TRIZ — Wikipedia](https://en.wikipedia.org/wiki/TRIZ), [MATRIZ Methodology](https://matriz.org/methodology/)

---

## MODERN / AI ERA

### 13. Agentic Plan Caching (NeurIPS 2025) — **ПРЯМОЙ АНАЛОГ**

**Что это.** Система, которая извлекает structured plan templates из выполненных AI-агентами задач, сохраняет их, и переиспользует для семантически похожих задач. NeurIPS 2025 paper.

**Сходство.** Практически идентичная архитектура: AI выполняет задачу → rule-based filter извлекает ключевую информацию → lightweight LLM удаляет context-specific элементы, создавая generalized template → keyword extraction для matching новых запросов → templates переиспользуются, снижая cost на 50-76%.

**Различие.** Нет human review — шаблоны создаются и применяются автоматически. Нет explicit approve/reject. Нет цели стать "полностью детерминированным" — system всегда использует LLM для адаптации cached plan.

**Уроки.** Ключевые метрики: 50% снижение cost, 27% снижение latency при сохранении 96.6% accuracy. Overhead от caching всего 1% от cost. Это подтверждает жизнеспособность подхода. Их two-stage filtering (rule-based → LLM-based generalization) — хороший архитектурный паттерн.

Sources: [Agentic Plan Caching — arXiv](https://arxiv.org/abs/2506.14852), [NeurIPS 2025 Poster](https://neurips.cc/virtual/2025/poster/116166)

---

### 14. Voyager Skill Library (Minecraft LLM Agent)

**Что это.** LLM-агент для Minecraft, который автоматически сохраняет успешно выполненные задачи как reusable code (JavaScript) в skill library. При новой задаче ищет похожие навыки через semantic similarity.

**Сходство.** AI решает задачу → решение сохраняется как executable code (= наш deterministic template) → при похожей задаче reuse из библиотеки → новые навыки композируются из старых. Библиотека растёт, агент становится всё более автономным.

**Различие.** Нет human review — skills добавляются автоматически после verification (self-verification). Навыки = исполняемый код, а не декларативные правила.

**Уроки.** Composability навыков (строить сложные из простых) — ключевая фича. Semantic similarity retrieval для matching работает хорошо. Self-verification (агент проверяет свой результат) может частично заменить human review для простых случаев.

Sources: [Voyager — arXiv](https://arxiv.org/abs/2305.16291), [Voyager Project](https://voyager.minedojo.org/)

---

### 15. Semantic Caching (GPTCache)

**Что это.** Кэширование ответов LLM через embedding similarity. Если новый запрос семантически похож на ранее обработанный, возвращается cached ответ без вызова LLM.

**Сходство.** Цель та же: снизить количество LLM-вызовов через переиспользование. Cache hit rates 61-80%. Снижение API calls на 68%.

**Различие.** Это exact response caching, а не generalized templates. Нет abstraction/generalization — кэшируется конкретный ответ. Нет human review. Нет evolving rule base.

**Уроки.** Semantic similarity threshold — ключевой параметр. Слишком низкий = cache misses, слишком высокий = неправильные ответы. Для нашей системы: template matching threshold должен быть калиброван, и ошибки в сторону "не матчится" безопаснее чем в сторону "неправильный матч".

See also: §1 (CBR) — оба основаны на similarity retrieval.

Sources: [GPTCache — GitHub](https://github.com/zilliztech/GPTCache), [GPT Semantic Cache paper — arXiv](https://arxiv.org/abs/2411.05276)

---

### 16. DSPy (Declarative Self-improving Python)

**Что это.** Framework от Stanford, где вместо ручного написания промптов, разработчик декларативно описывает input/output behavior, а система автоматически компилирует это в оптимизированные промпты и few-shot примеры.

**Сходство.** "Self-improving" в названии. Система автоматически собирает examples и оптимизирует промпты на основе метрик. Declarative specification вместо imperative prompting.

**Различие.** DSPy оптимизирует промпты (как вызывать LLM), а не создаёт deterministic rules (как НЕ вызывать LLM). Цель — улучшить качество LLM-ответов, а не заменить LLM правилами.

**Уроки.** DSPy показал что bootstrap (автоматическая генерация примеров из результатов) работает на удивление хорошо. Для нашей системы: первые шаблоны можно генерировать через bootstrap из AI-решений, даже без human review, для cold start.

Sources: [DSPy — Stanford](https://dspy.ai/), [DSPy Paper — ICLR 2024](https://arxiv.org/abs/2310.03714)

---

### 17. Snorkel (Data Programming / Labeling Functions)

**Что это.** Система для программного создания training data через labeling functions (LF) — эвристические правила, написанные экспертами. Snorkel автоматически моделирует accuracy и корреляции LF и комбинирует их в probabilistic labels.

**Сходство.** Эксперты пишут heuristic rules (= наши templates) → система комбинирует и применяет их → правила покрывают всё больше кейсов. 2.8x faster model building, 45.5% improvement vs hand labeling.

**Различие.** В Snorkel правила пишутся людьми вручную (не генерируются AI). Правила — labeling functions (Python code), не declarative templates. Цель — создать training data, а не заменить model inference.

**Уроки.** Snorkel показал что noisy/imperfect rules в комбинации дают хорошие результаты. Для нашей системы: даже неидеальные шаблоны полезны, если есть механизм оценки их reliability. Также generative model для разрешения конфликтов между правилами — важная идея.

Sources: [Snorkel Paper — arXiv](https://arxiv.org/abs/1711.10160), [Snorkel AI — Weak Supervision Guide](https://snorkel.ai/data-centric-ai/weak-supervision/)

---

### 18. NeMo Guardrails (NVIDIA)

**Что это.** Middleware layer для LLM, который определяет conversation flows и правила через специальный язык Colang. Каждый user input проходит через input rail pipeline, каждый response — через output rail pipeline.

**Сходство.** Deterministic rules (rails) применяются ПЕРЕД и ПОСЛЕ LLM. Если правило матчится — LLM не вызывается для этой части решения. Pre-defined conversation flows = наши templates.

**Различие.** Guardrails — это ограничения (что НЕ делать), а не decision templates (что делать). Нет learning loop — rails пишутся вручную. Цель — safety, а не efficiency.

**Уроки.** Colang как DSL для правил — хорошая идея. Чистый Python или JSON для templates может быть слишком verbose. Специализированный DSL для описания шаблонов может упростить human review.

See also: §2 (Expert Systems) — оба используют декларативные правила.

Sources: [NeMo Guardrails — Pinecone](https://www.pinecone.io/learn/nemo-guardrails-intro/), [NVIDIA NeMo Guardrails](https://developer.nvidia.com/nemo-guardrails)

---

### 19. Model Distillation (LLM → Smaller Model / Rules)

**Что это.** Teacher LLM генерирует synthetic data или reasoning chains → student model (меньше/дешевле) обучается на них. Варианты: дистилляция в neural network, в decision tree, или в rule set.

**Сходство.** Цель — заменить дорогой AI дешёвым детерминированным аналогом. Rule distillation (Neural Knowledge → Belief Rule Base) — прямо наш случай.

**Различие.** Distillation — batch process (обучение на датасете), не incremental. Нет human review отдельных правил. Student model может быть непрозрачной neural network, а не человекочитаемые правила.

**Уроки.** Comparative Knowledge Distillation (CKD, 2024) показал что из N teacher inference calls можно сгенерировать N² pairwise comparisons — экспоненциальный leverage. Для нашей системы: каждое AI-решение можно использовать не для одного шаблона, а для генерации нескольких шаблонов через comparison.

Sources: [LLM Distillation Guide — Snorkel AI](https://snorkel.ai/blog/llm-distillation-demystified-a-complete-guide/), [Rule Distillation — OpenReview](https://openreview.net/forum?id=qy024FMO1L)

---

### 20. Reflexion (NeurIPS 2023)

**Что это.** Framework для LLM-агентов, где агент рефлексирует на свои ошибки, сохраняет verbal self-critiques в episodic memory, и использует их для улучшения решений в следующих попытках.

**Сходство.** AI решает → оценивает результат → сохраняет "урок" в memory → использует уроки для будущих решений. Memory растёт, решения улучшаются.

**Различие.** "Уроки" — это natural language reflections, а не deterministic templates. Всё ещё требует LLM для интерпретации рефлексий. Нет человека в loop.

**Уроки.** Verbal reinforcement (текстовые заметки о том что пошло не так) — мощный механизм. Для нашей системы: помимо шаблонов, стоит хранить "meta-knowledge" о том ПОЧЕМУ шаблон был создан и какие ошибки он предотвращает.

See also: §22 (LangMem) — оба используют memory/reflection для улучшения.

Sources: [Reflexion — arXiv](https://arxiv.org/abs/2303.11366), [Reflexion — NeurIPS 2023](https://proceedings.neurips.cc/paper_files/paper/2023/file/1b44b878bb782e6954cd888628510e90-Paper-Conference.pdf)

---

### 21. Constitutional AI (Anthropic)

**Что это.** AI с набором принципов ("конституция"), по которым оценивает и исправляет свои ответы. Self-critique → self-revision → RLAIF (RL from AI Feedback).

**Сходство.** Принципы (конституция) = наши templates на мета-уровне. Они определяют "как должны выглядеть правильные решения". Self-improvement loop.

**Различие.** Конституция — фиксированный набор принципов, не растущая библиотека. Нет инкрементального добавления новых принципов из опыта. AI сам себя оценивает, а не человек.

**Уроки.** Natural language principles (а не формальные правила) работают удивительно хорошо. Для нашей системы: шаблоны могут быть на natural language уровне, а не только на формальном.

Sources: [Constitutional AI — Anthropic](https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback), [Claude's Constitution](https://www.anthropic.com/news/claudes-constitution)

---

### 22. LangMem SDK (LangChain)

**Что это.** SDK для long-term memory AI-агентов. Извлекает паттерны из успешных/неуспешных взаимодействий, обновляет system prompt, создавая feedback loop где core instructions эволюционируют.

**Сходство.** Агент учится из опыта → извлекает паттерны → обновляет своё поведение (prompt). Optimizer анализирует что работало/не работало и усиливает успешные паттерны.

**Различие.** Обновление происходит в промпте (а не в rule base). Нет human review. Нет перехода в детерминированный режим — всё ещё LLM-based.

**Уроки.** Automatic prompt evolution из feedback — интересная идея для bootstrap phase. Но без human oversight рискованно: prompt может дрейфовать в нежелательном направлении.

See also: §20 (Reflexion) — оба используют memory/reflection для улучшения.

Sources: [LangMem SDK Launch — LangChain Blog](https://blog.langchain.com/langmem-sdk-launch/)

---

### 23. Corrective RAG (CRAG)

**Что это.** RAG-система с feedback loop: оценивает качество retrieved documents и собственных ответов, при необходимости обращается к внешнему поиску, и со временем улучшает retriever через fine-tuning.

**Сходство.** Feedback loop улучшает систему. Успешные паттерны усиливаются. Ошибки корректируются.

**Различие.** Улучшается retrieval (какие документы находить), а не decision logic. Нет кристаллизации в deterministic rules.

**Уроки.** Evaluator component (оценка качества ответа) — ключевой элемент. Для нашей системы: нужен robust evaluation того, правильно ли шаблон сработал.

Sources: [Corrective RAG — Meilisearch](https://www.meilisearch.com/blog/corrective-rag), [Pistis-RAG — arXiv](https://arxiv.org/html/2407.00072v5)

---

### 24. GitHub Copilot Feedback Learning

**Что это.** Copilot отслеживает accept/reject/ignore для каждого suggestion. Interaction data используется для дообучения моделей. Система адаптируется к стилю конкретного разработчика.

**Сходство.** Human feedback (accept/reject) → model improvement. Система учится что работает для данного пользователя.

**Различие.** Feedback улучшает neural model, а не создаёт deterministic rules. Нет прозрачной библиотеки шаблонов, которую пользователь может просматривать.

**Уроки.** Models trained on interaction data showed "increased acceptance rates" — feedback loop реально работает. Но GitHub не даёт пользователю контроля над тем, как feedback используется. Наша система прозрачнее: пользователь видит и контролирует каждый шаблон.

Sources: [Evolving Copilot Suggestions — GitHub Blog](https://github.blog/ai-and-ml/github-copilot/evolving-github-copilots-next-edit-suggestions-through-custom-model-training/)

---

### 25. Confident Learning / Cleanlab

**Что это.** Framework для идентификации ошибок в labels (label noise) и обучения robust моделей несмотря на noisy data. Нашёл 100,000+ ошибок в ImageNet.

**Сходство.** Автоматическая оценка quality/confidence решений. Выделение "уверенных" и "неуверенных" случаев.

**Различие.** Направлен на cleaning data, а не на создание rules. Работает с labels, а не с decision templates.

**Уроки.** Confidence estimation критичен для решения "достаточно ли уверены чтобы создать шаблон?" Методы Cleanlab для оценки confidence можно адаптировать для оценки когда AI-решение достаточно reliable чтобы стать шаблоном.

Sources: [Cleanlab — GitHub](https://github.com/cleanlab/cleanlab), [Confident Learning — arXiv](https://arxiv.org/pdf/1911.00068)

---

### 26. Learning to Defer

**Что это.** ML-framework где модель решает: обрабатывать кейс самостоятельно или defer человеку. Оптимизирует boundary "модель vs человек" с учётом confidence и human expertise.

**Сходство.** Прямая аналогия с нашим "template match → auto-apply; no match → AI fallback → human review". Dual-threshold: high confidence = auto, low confidence = human, middle = AI.

**Различие.** Нет кристаллизации решений в шаблоны. Binary defer/not-defer, а не три режима (template / AI / human).

**Уроки.** Simple confidence threshold — suboptimal. Нужно учитывать не только confidence модели, но и "сложность для человека". Dual-threshold approach с зоной uncertainty — хороший паттерн.

Sources: [Learning to Defer — Montreal AI Ethics](https://montrealethics.ai/human-ai-collaboration-in-decision-making-beyond-learning-to-defer/), [Benchmarking L2D — Nature](https://www.nature.com/articles/s41597-025-04664-y)

---

### 27. Nonaka SECI Model (Knowledge Crystallization)

**Что это.** Модель организационного создания знаний: Socialization → Externalization → Combination → Internalization. "Externalization" — процесс кристаллизации tacit knowledge в explicit формы.

**Сходство.** Наша система — буквально SECI для AI: AI имеет tacit knowledge (neural weights) → Externalization кристаллизует его в explicit templates → Combination объединяет шаблоны → Internalization когда пользователи усваивают паттерны.

**Различие.** SECI — теоретическая модель для организаций, не software architecture. Нет автоматизации.

**Уроки.** Nonaka показал что знание создаётся через spiral: каждый цикл externalization → combination → internalization → socialization создаёт знание более высокого порядка. Наша система должна поддерживать эту спираль: шаблоны → мета-шаблоны → принципы.

Sources: [SECI Model — Wikipedia](https://en.wikipedia.org/wiki/SECI_model_of_knowledge_dimensions), [Nonaka SECI Operationalization — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6914727/)

---

### 28. Hybrid Rule-Based + ML Systems (skope-rules, scikit-learn)

**Что это.** Архитектуры, где deterministic rules обрабатывают known cases, а ML model — остальные. skope-rules извлекает interpretable rules из ensemble models.

**Сходство.** Прямая аналогия: rules покрывают "простые" кейсы с 100% accuracy, ML-model как fallback для остальных.

**Различие.** Rules извлекаются из trained model, а не из AI-решений. Нет human review. Статичная архитектура (нет incremental learning).

**Уроки.** "If a rule is simple, applicable in every case, and there are not too many rules overall, hard-coding it would guarantee perfect accuracy on a subset". Подтверждает нашу архитектуру: deterministic rules для known cases = guaranteed quality.

Sources: [Hybrid Rule-Based ML — Towards Data Science](https://towardsdatascience.com/hybrid-rule-based-machine-learning-with-scikit-learn-9cb9841bebf2/), [skope-rules — GitHub](https://github.com/scikit-learn-contrib/skope-rules)

---

### 29. Palantir Foundry Action Framework

**Что это.** Platform где решения кодифицируются как Actions в Ontology, с review workflow (explore → stage → commit), conflict resolution, и learning из истории решений.

**Сходство.** Решения → кодификация → review workflow (stage/commit) → reuse. Historical action log для анализа. Collaborative model с ролями (explore/stage/commit = draft/review/approve).

**Различие.** Нет AI-генерации решений. Люди принимают решения вручную. Нет fallback на AI.

**Уроки.** Palantir показал что capture decisions + learn from them — ценно даже без AI. Их review workflow (explore → stage → commit) — хороший UX-паттерн для нашего approve/reject/edit.

Sources: [Palantir Ontology](https://www.palantir.com/platforms/ontology/), [Action Log — Palantir](https://www.palantir.com/docs/foundry/announcements/2022-10/index.html)

---

### 30. RPA (Robotic Process Automation)

**Что это.** Системы, записывающие действия пользователя (clicks, keystrokes) и воспроизводящие их как автоматизацию. Эволюционировали в Intelligent Automation (RPA + AI).

**Сходство.** Record user actions → generalize → replay automatically. UiPath и подобные стали добавлять AI для handling неструктурированных данных, с fallback на человека.

**Различие.** RPA записывает exact actions, а не generalizes decisions. Brittleware — ломается при малейшем изменении UI.

**Уроки.** RPA показал что "запись и воспроизведение" работает для простых кейсов, но catastrophically fails при вариативности. Наша система через AI-генерализацию решает эту проблему, но должна иметь механизм detection когда шаблон стал неадекватным (UI/API изменился).

Sources: [RPA — Wikipedia](https://en.wikipedia.org/wiki/Robotic_process_automation), [UiPath RPA](https://www.uipath.com/rpa/robotic-process-automation)

---

## СВОДНАЯ ТАБЛИЦА БЛИЗОСТИ

| # | Аналог | Близость | AI генерирует | Human review | Deterministic rules | Incremental |
|---|---|---|---|---|---|---|
| 3 | **Ripple-Down Rules** | 95% | нет (человек) | да | да | да |
| 13 | **Agentic Plan Caching** | 90% | да | нет | частично | да |
| 14 | **Voyager Skill Library** | 85% | да | нет (self-verify) | да (code) | да |
| 4 | **EBL/Knowledge Compilation** | 80% | нет (логика) | нет | да | да |
| 5 | **SOAR Chunking** | 75% | нет (trace) | нет | да | да |
| 17 | **Snorkel** | 70% | нет (человек) | нет | да (LFs) | частично |
| 11 | **Active Learning** | 65% | да (модель) | да (labels) | нет | да |
| 1 | **CBR** | 60% | нет | нет | нет (similarity) | да |
| 16 | **DSPy** | 55% | да | нет | нет (prompts) | да |
| 28 | **Hybrid Rule-Based + ML** | 55% | нет (extraction) | нет | да | нет |
| 20 | **Reflexion** | 50% | да (reflections) | нет | нет (NL memory) | да |
| 9 | **RETE/Drools** | 50% | нет (человек) | нет | да | да |
| 26 | **Learning to Defer** | 50% | нет | нет | нет | нет |
| 2 | **Expert Systems (MYCIN)** | 50% | нет (человек) | нет | да | нет |
| 18 | **NeMo Guardrails** | 45% | нет (человек) | нет | да (Colang) | нет |
| 29 | **Palantir Foundry** | 45% | нет (человек) | да (workflow) | частично | частично |
| 25 | **Confident Learning** | 45% | нет | нет | нет | нет |
| 10 | **Version Spaces** | 40% | нет (алгоритм) | нет | частично | да |
| 21 | **Constitutional AI** | 40% | да (self-critique) | нет | нет (principles) | нет |
| 22 | **LangMem SDK** | 40% | да (extraction) | нет | нет (prompt) | да |
| 19 | **Model Distillation** | 40% | да (teacher) | нет | частично | нет |
| 6 | **Decision Trees (C4.5/RIPPER)** | 40% | нет (статистика) | нет | да | нет |
| 24 | **Copilot Feedback** | 35% | да (model) | да (accept/reject) | нет (neural) | да |
| 27 | **SECI Model** | 35% | нет | нет | нет (теория) | нет |
| 23 | **Corrective RAG** | 35% | нет | нет | нет | да |
| 12 | **TRIZ** | 30% | нет (человек) | нет | да (принципы) | нет |
| 7 | **ILP** | 30% | нет (индукция) | нет | да (FOL) | частично |
| 8 | **PROSE/FlashFill** | 30% | нет (synthesis) | частично (выбор) | да (programs) | нет |
| 30 | **RPA** | 25% | нет (запись) | нет | да (scripts) | нет |

---

## КЛЮЧЕВЫЕ ВЫВОДЫ ДЛЯ АРХИТЕКТУРЫ

### Must-have for MVP

1. 🔴 **RDR — главный учитель.** Инкрементальное добавление правил во время работы, привязка к cornerstone case, exception-based structure. 20+ лет production use в медицинских лабораториях.

5. 🔴 **Two-stage template extraction (из Agentic Plan Caching).** Rule-based filter → LLM-based generalization. Не пытаться сделать всё одним шагом.

7. 🔴 **Meta-knowledge (из Reflexion).** Хранить не только шаблон, но и "почему он был создан" и "какие ошибки предотвращает".

8. 🔴 **Conflict resolution (из Drools/RETE).** Стратегия приоритезации когда несколько шаблонов матчатся (specificity, recency, frequency).

3. 🔴 **Confidence calibration (из Learning to Defer + Confident Learning).** Не бинарный "match/no match", а confidence score. High confidence → auto-apply; medium → AI с template hints; low → full AI.

### Future iterations

2. 🔵 **Utility problem (из EBL).** Слишком много шаблонов → matching дороже AI-вызова. Нужен pruning: удалять/архивировать шаблоны которые редко матчатся.

4. 🔵 **Composability (из Version Space Algebra + Voyager).** Шаблоны должны быть composable: простые шаблоны можно комбинировать для сложных кейсов.

6. 🔵 **Ranked alternatives (из PROSE/FlashFill).** Предлагать несколько вариантов шаблона при human review, а не один.

9. 🔵 **Abstraction level (из TRIZ).** Шаблон должен быть на правильном уровне абстракции. Слишком специфичный = мало переиспользований. Слишком общий = неточные решения.

10. 🔵 **DSL для шаблонов (из NeMo Guardrails/Colang).** Специализированный язык описания шаблонов может быть лучше чем generic JSON/YAML.

---

## RECOMMENDED ARCHITECTURE

Синтез 30 аналогов в конкретную архитектурную рекомендацию.

### Core: RDR + Agentic Plan Caching

Фундамент — **RDR-based incremental template accumulation**. Шаблоны добавляются инкрементально во время работы, каждый привязан к cornerstone case (кейс, который спровоцировал создание). Exception-based structure: шаблон → исключение → исключение-из-исключения.

Extraction pipeline — **Agentic Plan Caching two-stage**:
1. **Rule-based filter**: из AI-решения извлекаются структурированные данные (component type, property, value, context)
2. **LLM-based generalization**: lightweight LLM удаляет context-specific детали, создавая reusable template

### Matching: RETE-inspired index

**TemplateIndex** на основе alpha memory:
```
Map<ruleId, Map<propertyKey, Template[]>>
```
O(1) lookup вместо O(n) linear scan. Incremental invalidation: при изменении файла инвалидируются только затронутые шаблоны.

**Conflict resolution** (формализованный):
```
finalScore = 0.5 * specificityScore + 0.3 * recencyScore + 0.2 * frequencyScore
```

### Learning loop: Reflexion + Constitutional AI

- **Reflexion-style meta-knowledge**: каждый шаблон хранит не только `when`/`then`, но и `why` — текстовое описание ПОЧЕМУ он был создан и какие ошибки предотвращает. Используется при conflict resolution и human review.
- **Constitutional AI-style principles**: набор meta-шаблонов ("принципов качества"), по которым система оценивает новые шаблоны перед добавлением. Например: "шаблон не должен противоречить существующим", "шаблон должен быть воспроизводимым".

### Human review: PROSE + Learning to Defer

- **PROSE/FlashFill ranked alternatives**: при human review предлагать 2-3 варианта шаблона с разной степенью generalization, а не один.
- **Learning to Defer confidence thresholds**: dual-threshold система определяет route решения:
  - `confidence > 0.9` → auto-apply template
  - `0.5 < confidence < 0.9` → AI с template hints
  - `confidence < 0.5` → full AI + human review

### DSL: NeMo Guardrails-inspired

Domain-specific template language для `when`-выражений (уже специфицирован в `ds-core-design.md` Section 13). Вдохновлён Colang: декларативный, человекочитаемый, проверяемый. Преимущества перед generic JSON/YAML: компактность, type-safety, IDE support.

### Quality control: Version Spaces + EBL

- **Version Space-inspired boundary tracking**: для каждого шаблона отслеживать его generalization/specialization boundary — "самый общий" и "самый конкретный" вариант, совместимый с наблюдениями. Помогает определить когда шаблон over/under-generalized.
- **EBL utility-based pruning**: когда количество шаблонов превышает threshold (например, 500 на rule), запускается pruning:
  - Архивировать шаблоны с `applyCount < 3` за последние 90 дней
  - Объединить шаблоны с `similarityScore > 0.95` между собой
  - Удалить шаблоны с `failRate > 0.3`

### Pipeline (как части соединяются)

```
Input (new case)
  │
  ▼
TemplateIndex.findMatching(case)  ← RETE-inspired alpha memory
  │
  ├─ match found ──► Conflict Resolution (specificity/recency/frequency)
  │                    │
  │                    ▼
  │                  Apply template ──► Confidence check
  │                                       │
  │                    ┌──────────────────┤
  │                    ▼                  ▼
  │                  high (>0.9)        medium (0.5-0.9)
  │                  auto-apply         AI + template hints
  │                    │                  │
  │                    ▼                  ▼
  │                  Done               AI result + human review
  │                                       │
  │                                       ▼
  │                                     Two-stage extraction
  │                                     (rule-based → LLM generalization)
  │                                       │
  │                                       ▼
  │                                     New template + meta-knowledge
  │                                       │
  │                                       ▼
  │                                     Quality check (Constitutional principles)
  │                                       │
  │                                       ▼
  │                                     TemplateStore.add()
  │
  └─ no match ──► Full AI fallback
                    │
                    ▼
                  Human review (ranked alternatives)
                    │
                    ▼
                  Two-stage extraction → TemplateStore.add()
```

Periodic maintenance (background):
- **Pruning** (EBL utility) — раз в неделю
- **Boundary tracking** (Version Spaces) — при каждом template failure
- **Principle validation** (Constitutional AI) — при каждом template addition
