# P024 RepoMapVerify 仓库地图核验仪｜PROJECT_BOOK.md

**PROJECT_ID:** P024
**SLUG:** repomapverify
**SPEC_VERSION:** 1.1.0（2026-11-14 修订：按 GPT 立项反馈 18 条修改，P0 4 / P1 10 / P2 4；v1.0.0 已被修订版取代；GPT 立项对话 https://chatgpt.com/g/g-p-6ade5013e8ec8191b55dca46c27772e1-agent-project-automatic/c/6af85d73-ca34-83ed-8691-3b900235b8af ，反馈原文见 00_control/P024_GPT_ESTABLISHMENT_REPLY.md）
**方向:** C01 RepoMapVerify 仓库地图核验仪（已锁定）
**立项评分（GPT 独立，规划假设，非实测）:** 21.6/25；RICE* 578（相对规划分）；GitHub 传播 4.7/5；收购潜力 4.3/5（我方初评 23/25、RICE 581.8、4.8/4.6；GPT 立项 2026-11-14 ~13:51 GMT，GPT-6 + Extra High，Pro 显示 Locked）
**SPEC_STATUS:** SPEC_FROZEN / IMPLEMENTED（建设完成，2026-11-14）
**PLAN_STATUS:** CONSTRUCTION_COMPLETE（建设完成；终审 R4 FAIL，修复中，待 R5；2026-11-14）
**GO_STATUS:** GO NOT DECLARED（终审 R4 FAIL，修复中，待 R5；2026-11-14）
**LICENSE:** MIT (Sam 决定，2026-11-13 ~18:02 GMT：全部项目许可证均为 MIT)
**参与政策:** ZERO_HUMAN_PARTICIPANTS
**用户价值测量:** USER_VALUE_NOT_MEASURED
**规格日期:** 2026-11-14

> RepoMapVerify 是一个本地优先、只读的 Agent 仓库理解核验工具。它回答：Agent 声称“学会”了一个仓库之后，它画出的模块图到底有几分是真的？每条 import 边是不是真的存在？入口点对不对？有没有凭空捏造的依赖、有没有漏掉的关键模块？它不生成地图、不改写代码、不调用 LLM，只拿 Agent 的声称地图与从仓库静态算出的真实 import 图逐项对账。

## 0. 一页摘要

### 0.1 一句话价值

**一条命令，核验 Agent 画的仓库地图是真是假：哪条边是编的、哪个入口是错的、哪个关键模块被漏了。**

示意输出（非实测）：

~~~text
$ repomapverify audit --repo ./billing-service --map ./agent-map.json

GROUND TRUTH: 47 modules, 132 import edges (Python 3.12, static)
CLAIMED MAP:  52 modules, 141 edges

  ✗ HALLUCINATED_EDGE: billing/api.py -> billing/refunds.py (claimed, no such import)
  ✗ HALLUCINATED_EDGE: billing/worker.py -> payments/ledger.py (claimed, no such import)
  ✗ WRONG_ENTRYPOINT: claimed entry billing/main.py; real entry billing/cli.py
  ! MISSING_EDGE: billing/api.py -> billing/auth.py (present, unclaimed)
  ! UNCLAIMED_REACHABLE_MODULE: billing/migrations/0007.py reachable from entry, unmentioned

RESULT: FAIL (2 hallucinated, 1 wrong entrypoint, 1 missing, 1 unclaimed reachable module)
Report: ./repomapverify-report.html
~~~

以上路径、名称和结果只是 UI 样例，不是对任何真实仓库或真实 Agent 的扫描结果。示例假设 .repomapverify.toml 已显式声明 billing/cli.py 为入口；无显式声明时只输出 ENTRYPOINT_CANDIDATE，不判 WRONG_ENTRYPOINT。

### 0.2 核心机制

1. 从仓库静态算出真实 import 图：Python / TypeScript / Go 三种语言的确定性 import 提取，不执行代码、不调用 LLM。
2. 读取 Agent 声称的仓库地图（JSON）：模块清单、入口点、依赖边。v1 只做静态 import 图核验，不核验数据流、函数调用路径或业务流程。
3. 模块身份与内容版本分离：module_id = SHA256(语言 + 规范化相对路径)，标识模块位置；content_sha256 = SHA256(文件内容)，标识模块版本（不用模块名作唯一身份，同名模块分属不同包时不得混淆）。
4. 地图必须声明完整性（completeness）：FULL_GRAPH（完整图，可查虚构边、遗漏边、遗漏模块）或 PARTIAL_SUBGRAPH（上下文裁剪子图，只核实已声明的边，不因缺少一条边判错；Aider Repo Map 等按 token budget 裁剪的地图必须以此模式输入）。地图必须绑定真实仓库快照（Git commit（如存在）+ 完整工作区快照 SHA-256 + 每个模块的内容 SHA-256）；快照不一致时返回 STALE_SNAPSHOT / INCOMPLETE，不得把旧地图的错误归咎于 Agent。
5. 入口点以 .repomapverify.toml 显式声明为准；无显式声明时只输出 ENTRYPOINT_CANDIDATE，不判 WRONG_ENTRYPOINT。
6. 逐项对账：声称边在真实图中是否存在、真实边是否被声称覆盖（仅 FULL_GRAPH）、入口点是否真实、模块是否可达、覆盖率。
7. 输入适配器：自定义 claimed-map/v1 JSON、Graphify graph.json、Understand-Anything .ua 图数据；Aider Repo Map 作 PARTIAL_SUBGRAPH 输入，不做遗漏边判定。
8. 输出 PASS / FAIL / INCOMPLETE 三态总结果及确定性 JSON / 静态 HTML 报告与 SHA-256 证据；无法完整解析时输出 UNKNOWN / INCOMPLETE，不把未知当作通过。

### 0.3 冻结边界

- 只做仓库地图核验，不做地图生成器、代码理解 Agent、重构工具或 IDE 插件。
- 默认只读；扫描不修改仓库文件、不改写声称地图、不写回任何结论到仓库。
- 只读安全边界：默认不跟随仓库外部符号链接；不执行被分析仓库的代码；不扫描 .git、node_modules 和构建产物，除非明确配置；不上传源码和路径到外部服务；报告支持查看、修改、删除；敏感路径可以脱敏。
- 不执行仓库代码、不执行地图中提到的任何命令或脚本。
- 报告为本地静态 HTML（左侧声称图，右侧真实图），不另建图数据库。
- 解析器依赖待 T001 验证：三语言解析先验证 Tree-sitter WASM 或等价 MIT 兼容方案，再冻结“无运行时依赖”承诺（见 §8.1）。
- 不调用 LLM、云 API、商业付费 API、远程模型或遥测服务。
- 0 名真人参与者；验证全部采用合成仓库、合成地图、固定输入、确定性算法和独立 Python Oracle 校验程序 + 48 个手工 Golden Expected Graph。
- 许可证 MIT（Sam 决定，2026-11-13 ~18:02 GMT；LICENSE 已加入仓库根目录）。

## 1. 用户、场景与痛点

### 1.1 目标用户

- **让 Agent 学仓库的开发者：** 用 rea / craft-anything / Claude Code 等 Agent 接手陌生仓库，先让 Agent“学会它如何工作”，再按 Agent 的地图动手改代码。
- **审 Agent 改动的 reviewer：** 收到 Agent 的大 PR，先看 Agent 附的仓库理解说明，再决定从哪开始审。
- **Agent 平台 /  harness 开发者：** 需要在发布前验证自家 Agent 的仓库理解能力是否达标、是否在退化。

### 1.2 典型场景

1. 接手一个陌生仓库，让 Agent 生成模块图，再核验一遍才动手改。
2. Agent 声称“入口是 main.py”，核验发现真实入口是 cli.py，改错文件之前拦下来。
3. Agent 的地图漏掉了支付模块，核验指出该模块从入口可达但未被提及。
4. 多 Agent 并行：A Agent 的地图与 B Agent 的地图互相矛盾，核验以真实图为准裁决。
5. 发布前用固定 fixture 重跑 CI，检测 Agent 版本升级后地图质量是否退化。
6. 招聘 / 采购评估：拿同一组标准仓库考不同 Agent 的地图准确率，横向对比。

### 1.3 痛点量化（规划假设，不是用户研究结果）

| 指标 | 初始假设 | 证据边界 |
|---|---:|---|
| 触发频率 | 每次 Agent 接手新仓库都触发；目标用户每周约 2–5 次相关核验 | NOT_MEASURED |
| 痛点强度 | 4/5 | 产品判断假设 |
| 一般排查代价 | 每次约 10–30 分钟（照错地图改错地方再返工） | 工程估算，未实测 |
| 严重故障代价 | 约 30–90 分钟，严重时改坏关键路径、构建炸掉 | 规划区间，非行业统计 |
| 当前 workaround | 自己读代码、grep import、凭经验判断地图对不对 | 慢，且抵消了让 Agent 学仓库的意义 |
| workaround 不足 | 人工抽查只能覆盖局部；地图越大越查不过来；Agent 自信的语气不等于正确 | 由公开趋势与真实项目规模支持 |

### 1.4 需求证据

**morluto/rea：** 456,439★（2026-11-14 检索，AI 榜第 1，+2,111/天）。“Point your agent at any app and learn how it works”——Agent 学应用如何工作是当前最热的 Agent 用途。地图的消费者已经以十万 star 计；地图的核验者尚不存在。

https://github.com/morluto/rea

**storytold/craft-anything：** 31.7k★，+1,331/天（2026-11-14 检索）。“Craft Anything: understand how any software works, and craft your own”——同一需求的第二个高速增长证据。

https://github.com/storytold/craft-anything

**Anthropic skills / obra/superpowers：** 189,429★ / 312,189★（2026-11-14 检索）。Agent 作为同事的规模证据：技能包以十万 star 计，Agent 深度介入日常开发，地图错误的 blast radius 随之放大。

https://github.com/obra/superpowers

**github/spec-kit：** 146,972★（2026-11-14 检索）。规格驱动开发：规格与实现一致性是行业级关注点；本项目把同一思想用于“Agent 的仓库理解”这一规格。

https://github.com/github/spec-kit

**claude-mem：** 110,570★（2026-11-14 检索，2026-11-02 趋势榜）。解决编码 Agent 跨会话丢上下文——同一主题的相邻证据：Agent 的记忆/理解不可靠是公认痛点；本项目核验的是理解的真实性而非记忆的持久性。

**Graphify：** 约 147.5k GitHub Stars（GPT 立项回复提供，2026-11-14，未独立核实）。确定性 AST 分析、跨文件关系图；边区分为 EXTRACTED 和 INFERRED。直接先例：本项目提供其 graph.json 输入适配器，并研究其图输出与边的来源标记。

**Understand-Anything：** 约 86.9k Stars（GPT 立项回复提供，2026-11-14，未独立核实）。Tree-sitter + LLM，有 graph-reviewer；已覆盖图完整性和引用完整性检查。直接先例：本项目提供其 .ua 图数据输入适配器；差异在于本项目是独立、确定性的验证层，不调用 LLM。

**Aider Repo Map：** 按 token budget 选择部分文件和符号；地图中没有某条边，不一定意味着生成错误。只有明确声明为完整图的输入，才允许检查遗漏边——这是 FULL_GRAPH / PARTIAL_SUBGRAPH 区分的直接依据。

证据边界：单个仓库的 star 数不能推算行业发生率；star 高不等于痛点强；不使用未经核实的市场规模或收购交易作为需求证据；痛点量化全部标注 NOT_MEASURED，未做用户访谈。

## 2. 差异化与已有方案边界

| 方案 | 已有能力 | RepoMapVerify 借鉴 | 不复制 |
|---|---|---|---|
| morluto/rea、storytold/craft-anything | 让 Agent 理解任意应用如何工作 | “理解仓库”是真实高频需求 | 不做另一个地图生成器；只核验地图真假 |
| 代码地图 / repo map 工具（code2prompt、repomix 类） | 把仓库打包成 Agent 可读文本 | 打包与抽取是成熟手段 | 不做打包器；只对账声称与真实 |
| 静态分析器（pyflakes、tsc、go vet、tree-sitter） | 单语言语法与类型检查 | import 提取的确定性基础 | 不做通用 lint；只做“地图 vs 真实图”对账 |
| 依赖图可视化（pydeps、madge、go mod graph） | 画出真实依赖图 | 真实图是 ground truth | 不做可视化产品；真实图只作内部比对基准 |
| SWE-bench 类评测 | 用测试判断 Agent 修没修问题 | 以真实产物为判据的思想 | 不做 Agent 能力榜；只做单次核验工具 |
| Graphify（~147.5k★，GPT 立项回复提供） | 确定性 AST 分析、跨文件关系图，边分 EXTRACTED / INFERRED | 图输出格式与边的来源标记；提供 graph.json 输入适配器 | 不做另一个知识图谱生成器；只做独立确定性验证层 |
| Understand-Anything（~86.9k★，GPT 立项回复提供） | Tree-sitter + LLM，graph-reviewer，图完整性与引用完整性检查 | .ua 图数据输入适配器；图完整性检查的先例 | 不调用 LLM；不做图生成；只做静态 import 图对账 |
| Aider Repo Map | 按 token budget 选择部分文件和符号的地图 | PARTIAL_SUBGRAPH 输入：只核实已声明边 | 不把 token-budget 裁剪误报成地图错误 |
| P020 CheckPath | CI 门覆盖模拟 | 确定性模拟 + 独立 Oracle 的工厂模式 | 不做 CI 门；核验对象是理解不是门禁 |
| P023 SkillScope | 技能作用域解析 | 身份 = 规范路径 + 内容 SHA 的做法 | 不做技能；核验对象是模块图 |

独立价值主张：

**Agent 声称的仓库地图 × 从仓库静态算出的真实 import 图，逐项对账的真实性核验。**

差异化在于：核验而非生成、真实图作 ground truth、模块身份用 module_id（语言 + 规范化相对路径哈希）与内容 SHA 分离、未知不等于通过、独立 Python Oracle 校验程序 + 48 个手工 Golden Expected Graph 和可复现 CI 回归。不声称全球首创。

## 3. 产品目标与非目标

### 3.1 MVP 目标

- 支持 Python、TypeScript、Go 三种语言的确定性 import 提取。
- 读取 Agent 声称地图（JSON）：模块清单、入口点、依赖边。v1 只做静态 import 图，不核验数据流、函数调用路径或业务流程。
- 输入适配器：自定义 claimed-map/v1 JSON、Graphify graph.json、Understand-Anything .ua 图数据；Aider Repo Map 作 PARTIAL_SUBGRAPH 输入，不做遗漏边判定。
- 声称地图必须声明完整性（FULL_GRAPH / PARTIAL_SUBGRAPH）并绑定真实仓库快照（Git commit（如存在）+ 完整工作区快照 SHA-256 + 每模块内容 SHA-256）；快照不一致返回 STALE_SNAPSHOT / INCOMPLETE。
- 计算真实 import 图：图节点（Python/TS 为 Module，Go 为 Package）、边、入口点可达集、未声明的可达模块、孤立模块。
- 区分 CLAIMED、VERIFIED、HALLUCINATED、MISSING、UNKNOWN、INVALID。
- 检测凭空捏造的边、错入口（仅 .repomapverify.toml 显式声明入口时）、漏报的边（仅 FULL_GRAPH）、未声明的可达模块（仅 FULL_GRAPH）、同名模块混淆、动态 import 误报（DYNAMIC_IMPORT_UNKNOWN）。
- 输出 PASS、FAIL、INCOMPLETE 三态总结果。
- 提供 CLI、JSON、静态 HTML 和 CI 退出码。
- 默认本地运行、无外部请求、无遥测、无 LLM。
- 提供独立 Python Oracle 校验程序 + 48 个手工 Golden Expected Graph 和 100 次确定性哈希重放（仅规范化语义结果）。

### 3.2 非目标

- 不生成仓库地图、不做 Agent、不做代码理解模型。
- 不执行仓库代码、不执行地图中提到的命令或脚本。
- 不判断代码质量、安全性或架构好坏。
- 不做重构建议、依赖升级或死代码删除。
- 不替代静态分析器、测试框架或 Code Review。
- 不保证 Agent 下次生成的地图会更好；只核验本次地图。
- 不保证动态语言的全部运行时 import 都能静态枚举；无法确定的必须 INCOMPLETE。
- 不读取 Cookie、账号令牌、聊天记录、真实对话或模型请求。
- 不连接真实模型，不发起真实 Agent 回合。
- 不做 SaaS、云端目录或远程遥测。

### 3.3 MVP 语言范围

| 语言 | v1.0 支持方式 | 关键边界 |
|---|---|---|
| Python | import / from 语句、__init__ 重导出、相对 import 解析 | from a.b import c 须核查实际模块存在（可能是属性而非子模块）；冻结支持的搜索路径与包结构；动态 import（importlib、__import__、exec）无法静态确定时 UNKNOWN |
| TypeScript | import / export / require、tsconfig paths 别名解析 | 冻结的解析范围：tsconfig paths、baseUrl、moduleResolution、package.json exports、相对路径扩展名解析；超纲解析一律 UNKNOWN；动态 import()、require 变量路径无法静态确定时 UNKNOWN |
| Go | import 块、module 路径解析、包级节点 | 图节点为 Package：同一 package 的多个源文件聚合为一个节点，源文件为组成证据；不同构建标签改变参与文件，标签集合 T001 冻结；cgo / 生成代码（*.pb.go、mock）标记 GENERATED，缺省不计入核心边 |

## 4. 核心规则模型

### 4.1 关键术语

- **Module / Package（图节点）：** 按语言区分：Python 图节点为 Module（一个 .py 源文件）；TypeScript 图节点为 Module（一个 .ts/.tsx 源文件）；Go 图节点为 Package（同一目录的多个 .go 源文件共同组成一个 package 节点；源文件是 package 的组成证据，不直接作文件级 import 节点）。包（Python package / TS 目录）不是独立节点。
- **Ground Truth Graph（真实图）：** 从仓库静态提取的图节点（Python/TS 为 Module，Go 为 Package）+ import 边 + 入口点可达集。
- **Claimed Map（声称地图）：** Agent 输出的 JSON：模块清单、入口点、依赖边；必须声明完整性（completeness）并绑定仓库快照（见 §4.2 与 §6.1）。v1 不含数据流声称。
- **Edge（边）：** 有向 import 关系 A → B（A 导入 B）。边身份 =（源 module_id，目标 module_id）。
- **Entrypoint（入口点）：** 可独立启动的模块（CLI main、服务启动文件、测试入口）。权威来源为 .repomapverify.toml 的 `[entrypoints]` 显式声明；一个仓库可有多个入口，不得仅凭图的根节点推断唯一入口。无显式声明时只输出 ENTRYPOINT_CANDIDATE，不判 WRONG_ENTRYPOINT。
- **Coverage（覆盖率）：** 已核验的声称条目 / 声称总条目；未核验的条目不能从分母中静默删除。
- **UNCLAIMED_REACHABLE_MODULE（未声明的可达模块）：** 真实图中从入口点可达、但声称地图未提及的模块（仅 FULL_GRAPH 判定）。
- **ISOLATED_MODULE（孤立模块）：** 真实图中从任何入口点均不可达、且声称地图未提及的模块；与未声明的可达模块是两种不同情况，仅作报告信息，不单独触发 FAIL。
- **Completeness（完整性声明）：** 声称地图的 completeness 字段：FULL_GRAPH（完整图，可查虚构边、遗漏边、遗漏模块）或 PARTIAL_SUBGRAPH（上下文裁剪子图，只核实已声明的边，不因缺少一条边判错）。
- **Repo Snapshot（仓库快照）：** 地图绑定的仓库版本：Git commit（如存在）+ 完整工作区快照 SHA-256 + 每个模块的内容 SHA-256；不能只依赖 Git commit（未提交修改不在 HEAD 中）。
- **Golden Expected Graph：** 每个 S0 fixture 手工编写的预期图：独立的预期节点、边与证据行；生产解析器输出与之比较，Oracle 不得复用生产解析器生成预期答案。

### 4.2 身份与哈希

每个图节点保存 language、node_kind（module | package）、relative_path（Go 为 package 目录）、content_sha256、module_id、is_generated、is_entrypoint、parse_status。Go package 节点的 content_sha256 为其组成源文件（按规范化相对路径排序后）内容哈希的 SHA-256 组合值，组成文件清单作为证据。

身份规则：

1. module_id = SHA256(language + normalized_relative_path)，标识模块位置；content_sha256 = SHA256(file_content)，标识模块版本。同一路径修改内容只改变 content_sha256，不改变 module_id。
2. 不以模块名（basename）作为唯一身份；同名不同路径的文件保持为不同模块。
3. 同一物理文件经符号链接多路径到达时归并为一个模块，并保留 alias；归并只在同一仓库内发生；默认不跟随仓库外部符号链接。
4. 内容 SHA 相同但路径不同的两个文件仍是两个模块；另报 DUPLICATE_CONTENT。
5. 导出报告默认使用相对路径；机器绝对路径和用户名默认脱敏。
6. 路径大小写、Unicode NFC 由平台适配器处理；无法确定文件系统大小写语义时不猜测。
7. 边身份是（源 module_id，目标 module_id）二元组；同名模块之间的边必须用 module_id 区分，不得按名合并。
8. 地图快照绑定：声称地图携带 repo_snapshot_sha256（完整工作区快照 SHA-256）与 git_commit（如存在）；核验时快照与当前仓库不一致返回 STALE_SNAPSHOT / INCOMPLETE，不得把旧地图的错误归咎于 Agent。

### 4.3 Python 规则

依据 Python 语言参考与 import 系统：

- import a.b 产生边（当前模块 → a.b 对应的模块文件）。
- from a.b import c 并不总是导入 a.b.c 子模块，也可能导入 a.b 中的属性：必须核查实际模块存在情况——a.b.c 作为模块文件存在时产生边，否则不产生子模块边（c 为属性，不作模块边）。
- 支持的 Python 搜索路径与包结构在 T001 冻结：仓库根 + 显式 src 布局 + __init__.py 包边界；超出冻结范围的解析一律 UNKNOWN，不猜测。
- 相对 import（from . import x、from ..pkg import y）按包结构解析到目标模块。
- __init__.py 的重导出（from .x import y）产生边（__init__ → x），且包名解析到 __init__.py 所在目录。
- 动态 import（importlib.import_module、__import__、exec、eval 中的 import 字符串）无法静态确定目标时，该源模块标记 DYNAMIC_IMPORT_UNKNOWN，审计 INCOMPLETE；字面量字符串参数可以解析，变量参数无法确定时返回 DYNAMIC_IMPORT_UNKNOWN；未知动态依赖属于 INCOMPLETE，不自动当成已验证的缺边；不得把动态 import 当作“无边”后 PASS。
- 条件 import（try/except ImportError、if TYPE_CHECKING）仍计边，但标记 CONDITIONAL；TYPE_CHECKING 块内的 import 只在类型检查时存在，计边并标注 TYPE_ONLY。
- 第三方库 import（site-packages、无源码）不计入仓库内边；计入 EXTERNAL_IMPORTS 计数，不作核验对象。
- 生成代码（protoc、sqlc、mockgen 产物，文件头含 generated 标记）标记 GENERATED；缺省不计入核心边，但声称地图引用它时仍须核验存在性。

### 4.4 TypeScript 规则

依据 TypeScript 模块解析：

- import / export ... from / import() / require() 均产生边；bare specifier 按 tsconfig paths 别名与 node_modules 解析顺序处理。
- 冻结的模块解析范围（T001）：tsconfig.json 的 paths、baseUrl、moduleResolution；package.json 的 exports；相对路径扩展名解析（.ts/.tsx/.js/.jsx 补全规则）。不支持的复杂解析情况一律输出 UNKNOWN，不猜测。
- tsconfig paths 别名（如 @/x → src/x）必须按 tsconfig.json 的 paths + baseUrl 解析；无 tsconfig 时不猜测别名。
- index.ts / index.tsx 的重导出按包目录解析；barrel 文件的边计入 barrel 本身，不透传到重导出目标（透传是另一条规则，需显式声明）。
- 动态 import()：字面量 import("./module") 可以解析；以变量为参数时无法静态确定目标，源模块标记 DYNAMIC_IMPORT_UNKNOWN，审计 INCOMPLETE；未知动态依赖属于 INCOMPLETE，不自动当成已验证的缺边。
- 类型专用 import（import type）在类型擦除后不存在，计边并标注 TYPE_ONLY。
- .d.ts 声明文件不产生运行时边；计入 TYPE_ONLY。
- 路径别名解析失败（tsconfig 缺失或 paths 未覆盖）时，相关边 UNKNOWN，不得静默丢弃。

### 4.5 Go 规则

依据 Go 模块系统：

- 图节点为 Package：同一目录的多个 .go 源文件共同组成一个 package 节点；源文件是 package 的组成证据，不直接作文件级 import 节点；包内文件互相引用不产生边。
- import 块中的每个路径产生包级边（源 package → 目标 package）；标准库路径不计入仓库内边，计入 EXTERNAL_IMPORTS。
- module 路径按 go.mod 的 module 声明解析；replace 指令按替换后路径处理。
- 不同构建标签（build tags）会改变参与构建的文件：package 的组成文件清单按 T001 冻结的默认构建标签集合确定；标签相关差异超出冻结范围时 UNKNOWN。
- 生成代码（*.pb.go、*.mock.go、stringer 产物）标记 GENERATED，缺省不计入核心边。
- cgo 文件（import "C"）标记 CGO，边不展开到 C 侧；审计不因此 INCOMPLETE，但须在报告中标注。
- vendor/ 目录下的模块按 vendor 内容解析；缺 vendor 目录时外部依赖不展开。

## 5. 规则判定、结果与问题分类

### 5.1 总体状态

| 状态 | 定义 |
|---|---|
| PASS | 所有声称条目已核验；无确认的捏造、错入口或漏报；无未解决 UNKNOWN |
| FAIL | 至少一项确认的捏造边、错入口、漏报边（仅 FULL_GRAPH）或未声明的可达模块（仅 FULL_GRAPH） |
| INCOMPLETE | 有无法解析 / 无法静态确定 / 版本未知的必需来源，无法证明完整性 |

INCOMPLETE 不得折算成 PASS。报告可同时列出已确认 FAIL 和未解决 UNKNOWN。

**快照不一致：** 声称地图的 repo_snapshot_sha256 与当前仓库快照不一致时，结果为 STALE_SNAPSHOT（视为 INCOMPLETE 的一种），不得把旧地图的错误归咎于 Agent；须先重新生成地图或重新绑定快照。

**PARTIAL_SUBGRAPH 模式：** 只核实已声明的边与模块；真实图中存在但声称地图未提及的边与模块不产生 MISSING_EDGE / UNCLAIMED_REACHABLE_MODULE；Aider Repo Map 等按 token budget 裁剪的地图必须以此模式输入。

**跳过项转 finding：** 扫描中被跳过的条目凡内容未知者必须转为 finding 或 INCOMPLETE，不得静默消失：源文件存在但不可读、文件过大（SOURCE_TOO_LARGE）、解析失败（PARSE_ERROR）均转为 SOURCE_NOT_ENUMERATED（P1/UNKNOWN）；文件不存在（ENOENT，声称地图引用了不存在的路径）是 HALLUCINATED 的一种，不转 UNKNOWN；生成代码的跳过按 §4 各语言规则处理，不重复转 finding。

### 5.2 Finding 类型

| Finding ID | 含义 | 默认严重度 |
|---|---|---|
| HALLUCINATED_EDGE | 声称的边在真实图中不存在 | P1 |
| HALLUCINATED_MODULE | 声称的模块在仓库中不存在 | P1 |
| WRONG_ENTRYPOINT | 声称的入口点不是真实入口（仅当 .repomapverify.toml 显式声明入口时；否则为 ENTRYPOINT_CANDIDATE） | P1 |
| MISSING_EDGE | 真实图中存在、声称地图未提及的边（仅 FULL_GRAPH） | P2 |
| UNCLAIMED_REACHABLE_MODULE | 真实图中从入口可达、声称地图未提及的模块（仅 FULL_GRAPH） | P2 |
| ISOLATED_MODULE | 真实图中从任何入口均不可达、声称地图未提及的模块；与未声明的可达模块是两种不同情况，仅作报告信息，不单独触发 FAIL | P2（信息） |
| ENTRYPOINT_CANDIDATE | 未显式声明入口时推断的候选入口，仅作提示，不判 WRONG_ENTRYPOINT | 信息 |
| NAME_COLLISION_CONFUSION | 同名不同路径模块被声称地图合并或张冠李戴 | P1 |
| DYNAMIC_IMPORT_UNKNOWN | 动态 import 无法静态确定，核验不完整（未知动态依赖属于 INCOMPLETE，不自动当成已验证的缺边） | P1 / INCOMPLETE |
| SOURCE_NOT_ENUMERATED | 源文件不可读 / 过大 / 解析失败，未能枚举 | P1 / INCOMPLETE |
| DUPLICATE_CONTENT | 不同路径的源文件内容哈希相同 | P2 |
| GENERATED_MISMATCH | 声称地图把生成代码当作手写模块（或反之） | P2 |

### 5.3 不做的推断

- 不根据模块存在推断 Agent 理解了它。
- 不根据声称地图没有某条边推断该边不重要。
- 不根据 PARTIAL_SUBGRAPH 地图没有某条边推断该边不存在。
- 不根据同名推断同一模块。
- 不根据内容哈希相同推断模块语义相同。
- 不把静态真实图冒充运行时调用图。
- 不推断 Agent 下次会做得更好，也不评估 Agent 的意图。

## 6. 数据结构与接口

### 6.1 声称地图示例（输入）

~~~json
{
  "schema": "repomapverify.claimed-map/v1",
  "map_id": "agent-run-2026-11-14-billing",
  "repo": "billing-service",
  "agent": "rea-0.9.1",
  "completeness": "FULL_GRAPH",
  "repo_snapshot_sha256": "<完整工作区快照 SHA-256>",
  "git_commit": "<如存在>",
  "modules": [
    {"id": "m1", "path": "billing/api.py", "kind": "module"},
    {"id": "m2", "path": "billing/auth.py", "kind": "module"}
  ],
  "entrypoints": ["billing/main.py"],
  "edges": [
    {"from": "billing/api.py", "to": "billing/auth.py"},
    {"from": "billing/api.py", "to": "billing/refunds.py"}
  ]
}
~~~

该示例只用于合成测试；真实地图由 Agent 输出提供，不写入公开 golden。PARTIAL_SUBGRAPH 示例只需把 completeness 改为 PARTIAL_SUBGRAPH；此时 MISSING_EDGE 与 UNCLAIMED_REACHABLE_MODULE 不适用。入口点声明见 .repomapverify.toml（§6.5）；示例中的 entrypoints 须与 toml 声明一致。

### 6.2 Module

~~~ts
interface ModuleV1 {
  moduleId: string;        // SHA256(language + normalized_relative_path)，标识模块位置
  language: "python" | "typescript" | "go";
  nodeKind: "module" | "package";  // Go 为 package
  relativePath: string;    // Go 为 package 目录
  contentSha256: string;   // SHA256(file_content)，标识模块版本；Go 为组成文件内容哈希的规范化组合
  isGenerated: boolean;
  isEntrypoint: boolean;
  parseStatus: "OK" | "UNREADABLE" | "TOO_LARGE" | "PARSE_ERROR";
  evidenceLevel: "STATIC_RULE";
}
~~~

### 6.3 Audit Report

~~~json
{
  "schema": "repomapverify.report/v1",
  "map_id": "agent-run-2026-11-14-billing",
  "status": "FAIL",
  "ground_truth": {"modules": 47, "edges": 132},
  "claimed": {"modules": 52, "edges": 141},
  "coverage": {"verified_claims": 138, "total_claims": 141},
  "findings": [
    {"id": "HALLUCINATED_EDGE", "severity": "P1",
     "from": "billing/api.py", "to": "billing/refunds.py"}
  ]
}
~~~

### 6.4 CLI 合同

~~~text
repomapverify audit --repo <path> --map <claimed-map.json> [--out <dir>] [--format json|html]
  exit 0: PASS
  exit 1: FAIL
  exit 2: INCOMPLETE
  exit 3: 用法 / 输入错误（地图 schema 非法、仓库路径不存在等）
repomapverify ground-truth --repo <path> [--lang python|typescript|go]
  只输出真实图 JSON（供调试与 Oracle 对照）
~~~

### 6.5 入口声明与输入适配器

`.repomapverify.toml`（仓库根目录，可选）：

~~~toml
[entrypoints]
paths = ["src/main.ts", "src/cli.ts"]
~~~

无此文件或 paths 为空时，不判 WRONG_ENTRYPOINT，只输出 ENTRYPOINT_CANDIDATE。

输入适配器（v1 至少提供）：

- 自定义 JSON：repomapverify.claimed-map/v1（§6.1）。
- Graphify graph.json → 内部 claimed-map 表示。
- Understand-Anything .ua 图数据 → 内部 claimed-map 表示。
- Aider Repo Map → 一律按 PARTIAL_SUBGRAPH 输入，不做遗漏边判定。

## 7. UI 与报告设计

### 7.1 主视图：声称图 vs 真实图并排对照（本地静态 HTML，不建图数据库）

- 左侧：Agent 声称的依赖图；右侧：真实静态 import 图；同一模块 / 边左右对齐。
- 颜色：红色 = 虚构或错误声明；黄色 = 无法确定（UNKNOWN / DYNAMIC_IMPORT_UNKNOWN）；绿色 = 已核实。
- 点击边查看源文件路径、行号和导入语句；点击模块见 §7.2 详情。
- 顶部汇总：真实图规模、声称规模、覆盖率、finding 计数（按严重度）、完整性模式（FULL_GRAPH / PARTIAL_SUBGRAPH）、快照状态。
- 错入口、未声明的可达模块与孤立模块单独成区，不得混进边列表。

### 7.2 模块详情

- 点击模块见：规范路径、内容 SHA、语言、是否生成代码、入边/出边（真实 vs 声称对照）、解析状态。

### 7.3 Finding 详情

- 每条 finding 含：类型、严重度、涉及路径、真实图证据（源文件行号）、声称地图证据（JSON 路径）。

### 7.4 静态 HTML

- 单文件、离线可读、无外部请求；报告内嵌 SHA-256 证据清单。
- 不另建图数据库：报告即产品展示方式，JSON 报告供 CI 与程序消费，HTML 供人阅读。

## 8. 技术架构与模块

### 8.1 技术栈

- 生产实现：TypeScript（Node 24）；测试用 vitest。运行时依赖承诺待 T001 验证后冻结：第一周先验证 Tree-sitter WASM 或等价 MIT 兼容解析方案，再冻结版本与许可证；验证前不承诺“完全无解析器依赖”。
- 独立 Oracle：Python 3.12 标准库 only 的独立校验程序 + 48 个手工编写的 Golden Expected Graph（每个 fixture 独立的预期节点、边与证据行）；生产解析器输出与 Golden Expected Graph 比较；Oracle 不得共享生产算法，不得由生产提取器生成 golden expected，不得复用生产解析器生成预期答案。
- 报告：JSON + 静态 HTML（模板内联，无外部资源）。
- 构建：npm；发布物 source.zip + dist.zip + SHA256SUMS.txt。

### 8.2 架构图

~~~text
claimed-map.json ──┐
                   ├─► comparator ──► report (JSON/HTML) + exit code
repo/ ──► extractors (py/ts/go) ──► ground-truth graph ──┘
                   │
                   └─► Python Oracle (independent checker)
                        + 48 hand-written Golden Expected Graphs
                        parity check: production output vs Golden, every field, no exemptions
~~~

### 8.3 模块归属

| 模块 | 职责 |
|---|---|
| src/extractors/python | Python import 提取（AST 基础，确定性） |
| src/extractors/typescript | TS import 提取 + tsconfig paths 解析 |
| src/extractors/go | Go import 提取 + go.mod 解析（包级节点） |
| src/graph | 真实图构建、规范路径、SHA、快照绑定、入口点可达集 |
| src/identity | 模块身份（module_id 与 content_sha256 分离）、alias 归并 |
| src/adapters | Graphify / Understand-Anything / Aider 输入适配（PARTIAL_SUBGRAPH 映射） |
| src/comparator | 声称 vs 真实对账、finding 分类 |
| src/report | JSON / HTML 报告、SHA 证据 |
| src/cli | CLI、退出码 |
| oracle/python | 独立 Python Oracle 校验程序 + Golden Expected Graph |

## 9. 隐私、安全与许可证

- 默认本地运行；扫描不发起任何外部请求；报告不上传任何内容。
- 只读：不修改仓库、不改写声称地图、不写回结论。
- 只读安全边界：默认不跟随仓库外部符号链接；不执行被分析仓库的代码；不扫描 .git、node_modules 和构建产物，除非明确配置；不上传源码和路径到外部服务。
- 隐私：报告默认使用相对路径；绝对路径与用户名默认脱敏；仓库内容 SHA 只用于核验，不上传；报告支持查看、修改、删除；敏感路径可以脱敏。
- 不执行仓库代码与地图中提到的任何命令；解析失败的源文件只报 finding，不尝试“修复后重读”。
- 许可证 MIT。

## 10. 验收标准

### 10.1 S0 硬验证门

- 固定 seed：P024-REPOMAPVERIFY-S0-2026-11-14。
- 48 个合成 fixture：3 语言（Python / TypeScript / Go）× 16 仓库（8 控制 + 8 植入）；语言矩阵：Python 16、TypeScript 16、Go 16，每种语言 8 控制 + 8 植入。
- 控制组：声称地图与真实图完全一致 → PASS，0 finding。
- 植入组：每例恰好一类植入缺陷（凭空边 / 错入口 / 漏边 / 未声明的可达模块 / 同名混淆 / 动态 import 误报 / 重导出误读 / 别名误解析），每类至少 2 例 → 必须检出。错入口植入例须在 .repomapverify.toml 中显式声明入口；无声明的 fixture 不判 WRONG_ENTRYPOINT。
- 48/48 Golden Oracle parity（生产解析器输出 vs 48 个手工 Golden Expected Graph，逐字段一致，无豁免；Oracle 校验程序独立实现，不复用生产解析器生成预期答案）。
- 24/24 植入检出；0/24 控制误报。24/24 只是冻结样本集的通过门槛，不代表对任意真实仓库有 100% 检测率。
- 100 次重放 1 个 gate hash（只对规范化语义结果哈希；排除当前时间、执行耗时、机器绝对路径、临时目录名、随机任务 ID 等非确定性字段）。
- 外部请求 0；源目录写操作 0；真人 0。

### 10.2 完整产品验收目标

- 三语言提取器在公开小型仓库样本上与 Golden Expected Graph 逐字段一致（样本由 T011 定义，不含真实私有仓库）。
- CLI 一条命令运行；报告离线可读；退出码与状态严格对应。
- 100 次重放 1 hash；外部请求 0；性能：1,000 模块仓库核验 ≤ 60 秒（VM 实测，T012 记录）。

### 10.3 性能目标（待 VM 实测）

- 1,000 模块 / 5,000 边仓库：ground-truth 提取 ≤ 30 秒，完整核验 ≤ 60 秒，内存 ≤ 512 MB。

## 11. 开源传播与产品化设计

### 11.1 README 首屏

~~~text
# RepoMapVerify — 你的 Agent 真的懂这个仓库吗？

一条命令，核验 Agent 的仓库地图是真是假。

$ repomapverify audit --repo ./billing-service --map ./agent-map.json
RESULT: FAIL — 2 hallucinated edges, 1 wrong entrypoint
~~~

### 11.2 开箱即用路径

- npm i -g repomapverify → 自带 demo 仓库 + demo 地图 → 一条命令出报告。
- CI：一行接入，地图不实即红。

### 11.3 GitHub 传播设计

- 受众明确：每个让 Agent 学仓库的开发者（rea 456k★ 证明规模）。
- 问题真实高频：每次 Agent 接手新仓库都触发。
- 开箱能跑：零配置，demo 一分钟出结果。
- README 一眼看懂价值：FAIL 样例即卖点。

### 11.4 产品级与潜在收购价值

- 代码智能厂商（Sourcegraph / Cursor / Codeium 类）需要“Agent 理解能力”的可度量标准；本工具是该标准的候选实现。
- Agent 平台需要发布前回归：同一组标准仓库，地图准确率是否退化。
- 标注为产品假设，不是承诺；无收购谈判、无收入预测。

## 12. 风险与停止条件

| 风险 | 等级 | 应对 |
|---|---|---|
| 多语言静态提取复杂度超预期（TS 别名、Go replace） | 中 | v1.0 只承诺三语言核心子集；超纲语法一律 UNKNOWN，不硬撑 |
| 动态 import 导致 INCOMPLETE 过多 | 中 | 明确标注动态边界；INCOMPLETE 是诚实输出，不是失败 |
| 声称地图格式不统一（各 Agent 输出各异） | 中 | v1.0 接受 claimed-map/v1 + Graphify graph.json + Understand-Anything .ua 适配器；Aider Repo Map 作 PARTIAL_SUBGRAPH；不追各家格式 |
| Tree-sitter WASM 验证失败 | 中 | 换等价 MIT 兼容解析方案；仍失败则缩减冻结的解析范围，S0 门槛不降 |
| 与 P011 上下文主题被误认为重复 | 低 | 边界已写明：本项目核验仓库静态理解，不碰对话上下文 |
| VM 内存 / 重启抖动 | 低 | 全量测试设 TMPDIR 到持久磁盘；分批跑 |

停止条件：S0 门任一指标不达标即 STOP，T005–T014 全部 BLOCKED，不得降门槛推进。

## 13. 最终交付物

- PROJECT_BOOK.md、IMPLEMENTATION_PLAN.md（本规格）。
- 源码（TypeScript）+ 独立 Python Oracle 校验程序 + 48 个手工 Golden Expected Graph。
- CLI + JSON / HTML 报告 + CI 退出码。
- source.zip + dist.zip + SHA256SUMS.txt + RELEASE_MANIFEST.json。
- 48 例 S0 fixture + 48 个手工 Golden Expected Graph + 100 次重放证据。
- README、docs、demo。

## 14. 参考资料

- morluto/rea — https://github.com/morluto/rea
- storytold/craft-anything — https://github.com/storytold/craft-anything
- obra/superpowers — https://github.com/obra/superpowers
- github/spec-kit — https://github.com/github/spec-kit
- Python import system — https://docs.python.org/3/reference/import.html
- TypeScript module resolution — https://www.typescriptlang.org/docs/handbook/modules/reference.html
- Go modules — https://go.dev/ref/mod
- P023 SkillScope 规格（工厂模式参考）— ~/workspace/p023-skillscope/01_spec/
