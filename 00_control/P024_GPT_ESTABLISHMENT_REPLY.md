# P024 GPT 立项回复记录（2026-11-14 ~13:51 GMT，浏览器任务回执）

- 对话：https://chatgpt.com/g/g-p-6ade5013e8ec8191b55dca46c27772e1-agent-project-automatic/c/6af85d73-ca34-83ed-8691-3b900235b8af
- 模型：GPT-6 Pro 显示 Locked（Usage limit reached），不可用；实际使用 GPT-6 + Extra High（思考档位 4/5）。
- Drive 读取：GPT 实际读取了 P024-repomapverify/00_spec 中的 PROJECT_BOOK.md 和 IMPLEMENTATION_PLAN.md 正文；未修改原文件，未更新 FACTORY_INDEX.md。
- 最终状态：**C01 RepoMapVerify LOCKED / REWORK_REQUIRED / GO NOT DECLARED，NO_CODE_BUILT**。GPT 没有说「规格确认无修改」，给出 18 条必须修改之处。
- GPT 独立评分：C01 21.6/25（我方 23/25），RICE* 578（我方 581.8），GitHub 传播 4.7、收购 4.3（我方 4.8/4.6）。所有分数均为立项假设，不是实测成绩；RICE* 为相对规划分。
- 排名：1 C01 21.6 / RICE* 578；2 C02 TestPathProof 21.5 / 633；3 C03 DirtyFence 20.5 / 400；4 C04 ExitPath 20.6 / 589（生存性不通过）；5 C06 19.6 / 630（生存性不通过）；6 C07 19.8 / 490（生存性不通过）；7 C05 18.5 / 288（可行性不通过）；8 C08 17.5 / 324（生存性不通过）。C02 值得 P025 再研究。

## 关键新发现（竞争格局）

- Graphify：约 147.5k GitHub Stars，确定性 AST 分析、跨文件关系图；边区分为 EXTRACTED 和 INFERRED。P024 必须研究其图输出和边的来源标记。
- Understand-Anything：约 86.9k Stars，Tree-sitter + LLM，有 graph-reviewer；已覆盖图完整性和引用完整性检查，是重要直接先例。
- Aider Repo Map 会根据 token budget 选择部分文件和符号；地图中没有某条边，不一定意味着生成错误。只有明确声明为完整图的输入，才允许检查遗漏边。
- 差异定位：生成代码知识图 ≠ 独立、确定性地证明源代码依赖关系确实存在。P024 应成为独立验证层，而不是再造一个代码知识图谱生成器。

## 18 条必须修改之处（按阻断程度）

### P0：必须修复后才能进入 S0

1. 地图完整性必须有明确声明：规格把地图缺边视为错误，但未区分完整地图和上下文裁剪地图。在 ClaimedMapV1 增加 `{"completeness":"FULL_GRAPH","repo_snapshot_sha256":"...","schema":"repomapverify.claimed-map/1"}`。两种模式：FULL_GRAPH 可检查虚构边、遗漏边、遗漏模块；PARTIAL_SUBGRAPH 只能核实已声明的边，不能因缺少一条边就判定错误。否则会把 Aider 的正常 token-budget 裁剪误报成地图错误。
2. 必须绑定真实仓库快照：地图身份与仓库当前内容之间缺少明确版本绑定。增加：Git commit（如存在）、完整工作区快照 SHA-256、规范化相对路径、每个模块的内容 SHA-256。不能只依赖 Git commit（未提交修改不在 HEAD 中）。地图快照与当前仓库不一致时，返回 STALE_SNAPSHOT / INCOMPLETE，不能把旧地图的错误归咎于 Agent。
3. Go 的模块定义必须修正：项目书把 Module 定义为一个源文件，又说 Go 同一 package 的多个文件聚合成一个节点，定义冲突。Go 的 package 由同目录多个源文件共同组成；import 关系是 package 级依赖；不同构建标签会改变参与构建的文件。统一为：Python 图节点 Module；TypeScript 图节点 Module；Go 图节点 Package。Go 源文件作为 package 的组成证据，不能直接当成普通文件级 import 节点。
4. 入口点必须有权威来源：WRONG_ENTRYPOINT 缺乏足够明确的 ground truth。Python 可通过项目脚本声明入口；Node.js 有 package.json 的 bin、exports 等机制；Go 有 package main 和 func main()。但一个仓库可有多个入口，不能仅凭图的根节点推断唯一入口。建议增加 .repomapverify.toml：`[entrypoints] paths=["src/main.ts","src/cli.ts"]`。没有显式入口声明时，只输出 ENTRYPOINT_CANDIDATE，不判 WRONG_ENTRYPOINT。

### P1：算法与数据契约

5. 模块 ID 与内容哈希分离：目前用路径加内容 SHA-256 作为模块身份，同一路径修改内容就产生新模块身份。建议：module_id = SHA256(language + normalized_relative_path)；content_sha256 = SHA256(file_content)。前者标识模块位置，后者标识模块版本。
6. Python 导入语义不能过度简化：`from a.b import c` 并不总是意味着导入 a.b.c 子模块，也可能导入 a.b 中的属性。必须检查实际模块存在情况，并明确支持的 Python 搜索路径和包结构。
7. TypeScript 必须明确支持的模块解析范围：冻结 tsconfig.json 的 paths、baseUrl、moduleResolution、package.json 的 exports、相对路径扩展名解析。不支持的复杂解析情况必须输出 UNKNOWN，不能猜测。
8. 动态导入不应产生虚假确定性：字面量 `import("./module")` 可以解析；变量 `import(moduleName)` 不能确定时返回 DYNAMIC_IMPORT_UNKNOWN。未知动态依赖属于 INCOMPLETE，不应自动当成已验证的缺边。
9. 删除尚未实现的 Data Flow 声明：当前产品实际实现的是 import graph。不应在项目书中让用户以为已验证完整数据流、函数调用路径或业务流程。v1 只做静态导入图。
10. 修正 ORPHAN_MODULE 的定义：当前所谓 ORPHAN_MODULE 实际上是可达模块没有出现在声明地图中。建议改名 UNCLAIMED_REACHABLE_MODULE。孤立节点和未声明的可达节点是两种不同情况。
11. 修改一个错误的数学测试属性：实施计划中的「边对称性」不成立。有向导入图中 A→B 并不意味着 B→A。应改为：边方向保持正确；重复边规范化幂等；输入文件顺序变化不影响规范化结果；不自动生成反向边。

### P1：Oracle 与验收标准

12. 独立 Python Oracle 需要重新定义：目前计划用 Python 标准库实现三语言 Reference Oracle。Python 标准库 AST 能解析 Python，但不能直接提供 TypeScript、Go 的完整语义解析。建议把 Oracle 改为：Python 独立校验程序 + 48 个手工编写的 Golden Expected Graph，每个 fixture 有独立预期节点、边和证据行，生产解析器输出与 Golden Expected Graph 比较。Oracle 不应直接复用生产解析器生成预期答案。
13. 48 个 fixture 必须明确语言覆盖矩阵：S0 固定门槛：48 合成 fixture；24 植入错误；24/24 植入错误检出；0 控制组误报。其中 Python 16 个、TypeScript 16 个、Go 16 个；每种语言 8 个控制、8 个植入错误；Golden Oracle 48/48 一致；100 次重放规范化输出 SHA-256 完全一致。这里的 24/24 只是冻结样本集的通过门槛，不代表对任意真实仓库有 100% 检测率。
14. 100 次重放必须排除非确定性字段：哈希不能包含当前时间、执行耗时、机器绝对路径、临时目录名称、随机任务 ID。只对规范化语义结果进行哈希。

### P2：工程与产品边界

15. 修改无运行时依赖的承诺：三语言语法解析、模块解析和跨平台运行，不应同时承诺完全没有解析器依赖。建议第一周先验证 Tree-sitter WASM 或等价的 MIT 兼容方案，再冻结版本与许可证。
16. 明确只读安全边界：默认不跟随仓库外部符号链接；不执行被分析仓库的代码；不扫描 .git、node_modules 和构建产物，除非明确配置；不上传源码和路径到外部服务；报告支持查看、修改、删除；敏感路径可以脱敏。
17. 增加 Graphify 和 Understand-Anything 输入适配器：不能只支持自定义 claimed-map/v1。建议 v1 至少提供：自定义 JSON；Graphify 的 graph.json；Understand-Anything 的 .ua 图数据。Aider 的 Repo Map 作为 PARTIAL_SUBGRAPH 输入，不做遗漏边判定。
18. 修改产品展示方式：不需要另建复杂的图数据库。一个本地 HTML 报告即可：左侧 Agent 声明的依赖图，右侧真实静态导入图；红色虚构或错误声明，黄色无法确定，绿色已核实；点击边查看源文件路径、行号和导入语句。

## 第一周动手步骤（GPT 建议）

只攻克 S0，总预算仍 88 小时（72 + 16 缓冲），第一周约 38 小时：
- Day 1 T001 环境探测、产品边界冻结、输入输出 schema 修订（FULL/PARTIAL 模式）。
- Day 2 T002 Graphify、Understand-Anything 输入格式适配 PoC。
- Day 3 T003 Python、TypeScript、Go 解析器技术验证（每种语言至少 5 个确定性样本）。
- Day 4 T004 统一图结构、路径规范化、snapshot SHA、导入解析。
- Day 5 T005 独立 Golden Oracle 和 48 个 fixture。
- Day 6 T006 图比较器、finding 分类、JSON CLI（区分 FAIL、INCOMPLETE、PASS）。
- Day 7 T007 S0 全量自动化门禁与独立审查。
- 第一周环境命令：node -v；npm -v；python --version；go version；git --version。实际环境以 T001 探测为准，不假设 Go 已安装。
- S0 通过条件：48 fixture 全部通过 Golden Oracle；24/24 植入检出；0/24 控制误报；100 次重放同一规范化哈希；三语言解析边界有明确记录；动态导入和不支持语法不会被误判为已验证；独立审查者复核 Oracle 与生产解析器没有共享预期答案生成逻辑。S0 未通过：只修复阻断项，不提前进入完整 UI、发布和扩展功能开发。

## 未做事项

未修改 Drive 中的任何规格文件，未更新 FACTORY_INDEX.md。后续需按上述 18 条修订 PROJECT_BOOK.md 与 IMPLEMENTATION_PLAN.md 并补齐对应 DOCX，四份规范文件齐备才可以正式进入 S0 开发。
