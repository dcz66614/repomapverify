# P024 规格核实记录（修订版 v1.1.0，Muse 亲自核实，2026-11-14 ~13:57 GMT）

> 本记录取代 2026-11-14 ~13:10 GMT 的 v1.0.0 核实记录（该记录已过时：v1.0.0 规格已被 GPT 立项反馈修订为 v1.1.0）。
> 修订依据：GPT 立项回复（2026-11-14 ~13:51 GMT，GPT-6 + Extra High，Pro 显示 Locked；对话 https://chatgpt.com/g/g-p-6ade5013e8ec8191b55dca46c27772e1-agent-project-automatic/c/6af85d73-ca34-83ed-8691-3b900235b8af ；反馈原文 00_control/P024_GPT_ESTABLISHMENT_REPLY.md）。GPT 结论：C01 LOCKED / REWORK_REQUIRED / GO NOT DECLARED，给出 18 条必须修改之处（P0 4 / P1 10 / P2 4）。

## Drive 归档核实：通过

- 文件夹：agent project auto / P024-repomapverify（id 1E8p_0RB6Dm3cajWqcUe25qmpRWc1sLLW）/ 00_spec（id 1w_yE-Jpk_AQuZ7cOhtaSLpx28ynCoN1X）
- PROJECT_BOOK.md：39,416 B，id 1WTIQMcpfarVr_stfQ7nWAQiDdqYA-eav，sha256 4ac883e496f315ac45f4a2347a93c521d27a11e7cfb8e122ee430362260f9d01（v1.0.0 为 25,947 B / 117b9784…；已原位替换，id 不变）
- IMPLEMENTATION_PLAN.md：22,725 B，id 1LfqN8WwheL1kdtBTbYbdYhuQgWWVo4w5，sha256 5a6e9282e720e76ac95136db0d0a354993191040f7c2319dffd7604dd320cb0b（v1.0.0 为 15,886 B / 14595915…；已原位替换，id 不变）
- 重下载 SHA 与本地完全一致；00_spec 内仅此两文件，无重复、无新增。
- 本地副本：~/workspace/p024-repomapverify/01_spec/（与 Drive 一致）。

## 18 条修改逐项核对：全部已应用

### P0（4 条）

1. **完整性声明（FULL_GRAPH / PARTIAL_SUBGRAPH）**：项目书 §0.2(4)、§4.1 Completeness 术语、§5.1 PARTIAL_SUBGRAPH 段落、§6.1 示例（含 completeness 字段）与计划 §4.1 ClaimedMapV1（含 completeness 字段）、§4.5。PARTIAL_SUBGRAPH 只核实已声明边，不产生 MISSING_EDGE / UNCLAIMED_REACHABLE_MODULE；Aider Repo Map 必须以此模式输入。
2. **真实仓库快照绑定**：项目书 §0.2(4)、§4.1 Repo Snapshot 术语、§4.2 规则 8、§5.1 STALE_SNAPSHOT 段落、§6.1 示例（含 repo_snapshot_sha256 + git_commit）；计划 §4.1、T006 验收。快照不一致返回 STALE_SNAPSHOT / INCOMPLETE，不把旧地图错误归咎于 Agent；不只依赖 Git commit。
3. **Go 包级节点**：项目书 §3.3 Go 行、§4.1 图节点术语、§4.2 节点头、§4.5 全节、§6.2 nodeKind、§8.3；计划 §4.2、T003、T005。Python/TS 节点为 Module，Go 节点为 Package（同目录多文件聚合；源文件为组成证据；构建标签集合 T001 冻结）。
4. **权威入口点（.repomapverify.toml）**：项目书 §0.2(5)、§0.1 示例注、§4.1 Entrypoint 术语、§5.2 WRONG_ENTRYPOINT 行、§6.5；计划 §4.5、T001、T005、§6.1。无显式声明只输出 ENTRYPOINT_CANDIDATE，不判 WRONG_ENTRYPOINT。

### P1——算法与数据契约（7 条）

5. **module_id / content_sha256 分离**：项目书 §0.2(3)、§4.2 规则 1、§6.2、§8.3；计划 §4.2、T001、T005。module_id = SHA256(语言 + 规范化相对路径)，content_sha256 = SHA256(文件内容)。
6. **Python import 语义**：项目书 §3.3 Python 行、§4.3 前三条；计划 T002。from a.b import c 须核查实际模块存在（属性不作子模块边）；搜索路径与包结构 T001 冻结。
7. **TypeScript 解析范围冻结**：项目书 §3.3 TS 行、§4.4 第二条；计划 T003。冻结 tsconfig paths、baseUrl、moduleResolution、package.json exports、相对路径扩展名解析；超纲一律 UNKNOWN。
8. **动态 import → DYNAMIC_IMPORT_UNKNOWN**：项目书 §4.3、§4.4、§5.2；计划 T007。字面量可解析，变量参数无法确定时返回 DYNAMIC_IMPORT_UNKNOWN；未知动态依赖属于 INCOMPLETE，不自动当成已验证的缺边。
9. **删除 Data Flow 声明**：项目书 §0.2(2)、§3.1、§4.1 Claimed Map 均已删“数据流声称”，改为“v1 只做静态 import 图核验，不核验数据流、函数调用路径或业务流程”。全文 grep：剩余“数据流”三处均为否定表述，无残留声称。
10. **ORPHAN_MODULE → UNCLAIMED_REACHABLE_MODULE**：项目书 §0.1 示例、§3.1、§4.1、§5.1、§5.2、§10.1、计划 §6.1、T006 均已改名；新增 ISOLATED_MODULE（从任何入口均不可达，仅作报告信息，不单独触发 FAIL）与 ENTRYPOINT_CANDIDATE；finding 类型由 10 类增至 12 类（T006 验收列明）。全文 grep：ORPHAN / 孤儿零残留。
11. **修正“边对称性”**：计划 T011、§7.1 已改为“边方向保持正确、重复边规范化幂等、输入文件顺序变化不影响规范化结果、不自动生成反向边”。全文 grep：两文件“对称”零残留。
12. **Oracle 重定义为 Python 校验程序 + 48 个手工 Golden Expected Graph**：项目书 §0.2(8)、§0.3、§3.1、§4.1 Golden 术语、§8.1、§8.2、§8.3、§10.1、§10.2、§13；计划 §0 规则 4、§4.4、§7.2、T004。Oracle 不得复用生产解析器生成预期答案；独立审查者复核无共享预期答案生成逻辑。全文 grep：“Reference Oracle”旧称零残留（已统一为 Oracle 校验程序 + Golden Expected Graph）。
13. **Fixture 语言矩阵**：项目书 §10.1、计划 §6.1、T004。Python 16 / TS 16 / Go 16，各 8 控制 + 8 植入；24/24 只是冻结样本集门槛，不代表任意真实仓库 100% 检测率。
14. **重放哈希排除非确定性字段**：项目书 §10.1、计划 §6.2、T004、T008。只对规范化语义结果哈希；排除当前时间、执行耗时、机器绝对路径、临时目录名、随机任务 ID。

### P2——工程与产品边界（4 条）

15. **“无运行时依赖”承诺改为 T001 验证后冻结**：项目书 §0.3、§8.1、§12（新增 Tree-sitter WASM 验证失败风险行）；计划 §3.2、§9、T001。第一周先验证 Tree-sitter WASM 或等价 MIT 兼容方案，再冻结版本与许可证。全文 grep：“无运行时依赖”仅余一处，为“再冻结‘无运行时依赖’承诺”的限定表述。
16. **只读安全边界**：项目书 §0.3、§9；计划 §0 规则 7、§7.3。默认不跟随仓库外部符号链接；不执行被分析仓库的代码；不扫描 .git、node_modules 和构建产物，除非明确配置；不上传源码和路径到外部服务；报告支持查看、修改、删除；敏感路径可脱敏。
17. **Graphify / Understand-Anything 输入适配器**：项目书 §0.2(7)、§1.4（新增两先例 + Aider 说明）、§2 表（新增三行）、§3.1、§6.5、§8.3（新增 src/adapters）、§12；计划 §4.5、T002（PoC）、T008（完整适配器）、§2.1（src/adapters 归属）。Aider Repo Map 一律 PARTIAL_SUBGRAPH。
18. **HTML 报告代替图数据库**：项目书 §0.3、§7.1（并排对照：左声称图、右真实图；红虚构/错误、黄无法确定、绿已核实；点击边见路径、行号、导入语句）、§7.4、§8.1；计划 T009。不另建图数据库。

## DOCX 问题：已查 P023 先例，结论为 MD-only，不建 DOCX

- GPT 称 S0 前需要 4 份规格文件（2 MD + 2 DOCX 对应件）。已查 P023 先例：P023 冻结规格集只有两份 MD——本地 ~/workspace/p023-skillscope/01_spec/ 仅 PROJECT_BOOK.md 与 IMPLEMENTATION_PLAN.md；Drive 00_spec（id 15IiNTdyBBEPkRc6dE1MH9GjmsM4AgLb8）同样仅此两份 MD（P023 核实记录亦确认“00_spec 内仅此两文件”）。
- 工厂规范是 MD-only；GPT 的 4 文件要求不是工厂惯例，不采纳，不虚构 DOCX 工作。P024 00_spec 仍为两份 MD。

## 内容核实：通过

- SPEC_VERSION 1.1.0（两文件一致），SPEC_FROZEN / NOT_IMPLEMENTED，PLAN_STATUS READY_FOR_S0_ONLY，GO NOT DECLARED。
- LICENSE MIT（Sam 决定，2026-11-13 ~18:02 GMT）。ZERO_HUMAN_PARTICIPANTS（零真人）。
- S0–S5、T001–T014 齐全（14 张任务卡全在）；工时 72h + 16h 缓冲 = 88h（S0 17h = 3+4+5+5；S1 9h；S2 10h；S3 12h；S4 12h；S5 12h；合计 72h，与 v1.0.0 一致，未变）。
- S0 硬门：固定 seed P024-REPOMAPVERIFY-S0-2026-11-14；48 个合成 fixture（Python 16 / TS 16 / Go 16，各 8 控制 + 8 植入）；48/48 Golden Oracle parity；24/24 植入检出；0/24 控制误报；100 次重放 1 个 gate hash（仅规范化语义结果）；外部请求 0；源目录写操作 0；真人 0。
- 评分已更新为 GPT 独立数据（两文件头）：21.6/25；RICE* 578（相对规划分）；GitHub 传播 4.7/5；收购潜力 4.3/5；并注明为规划假设、非实测（我方初评 23/25、RICE 581.8、4.8/4.6 保留作对照）。
- GPT 第一周顺序已作为参考记入计划 §1.1（映射到现有任务卡，不改编号与工时），S0 通过条件全文收录。
- 证据边界诚实：痛点量化仍标注 NOT_MEASURED；趋势 star 数标注 2026-11-14 检索来源；Graphify 约 147.5k★ 与 Understand-Anything 约 86.9k★ 明确标注为“GPT 立项回复提供，未独立核实”，未编造仓库链接；高 Star 潜力与收购价值标注为产品假设、不是承诺；规格中不填虚构哈希。
- 竞争格局已补入规格：Graphify、Understand-Anything 为直接先例（§1.4、§2），差异定位为“独立、确定性的验证层，而不是再造代码知识图谱生成器”。
- GPT 排名备注：C02 TestPathProof（21.5 / RICE* 633）值得 P025 再研究——记于此，不入规格。
- 三个关键工程决定仍冻结：核验而非生成、真实图作 ground truth、未知不等于通过。

## 未完成项（留待以后统一处理）

- 两份 Drive 文件尚未加入 ChatGPT 项目 agent project automatic 的项目来源——未完成，留待以后统一处理（P012–P023 同样未加）。

## 结论

规格 REWORKED + 重新 ACCEPTED（v1.1.0，18/18 项已应用并逐项核对）。工作目录 ~/workspace/p024-repomapverify/，规格存入 01_spec/。S0 在规格侧已无阻断；下一步为派发 T001（Sam 2026-11-14 ~13:00 GMT 已说“p024继续吧”，按 P023“继续p023不用等我说”先例视为继续推进的授权，由主聊天决定是否即派发）。
