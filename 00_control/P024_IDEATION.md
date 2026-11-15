# P024 立项构思记录（Muse，2026-11-14 ~13:05 GMT）

> 来源：GitHub Trending 实况检索（2026-11-14，见 §1）。按 P020+ 规则：从 GitHub 热门项目出发找真实痛点，痛点先行，技术后行；零真人；MIT；88h。
> 本记录由 Muse（总控）直接完成；GPT 立项对话由主聊天另行发起（浏览器任务），本记录 + 规格文件随附为立项输入。

## 1. 趋势证据（2026-11-14 检索，公开 star 数，不作质量背书）

| 仓库 | 信号 | 与本立项的关系 |
|---|---|---|
| morluto/rea | 456,439★，+2,111/天，AI 榜第 1 | “把 Agent 指向任何应用，了解它如何工作”——Agent 学仓库是头号用途 |
| storytold/craft-anything | 31.7k★，+1,331/天 | “理解任何软件如何工作，再自己造”——同上 |
| alibaba/open-code-review | 50,981★，+215/天，当日第 1 | AI 代码评审：确定性流水线 + LLM Agent |
| openai/codex-security | 13,320★，+751/天 | 找漏洞、修漏洞的 CLI + SDK |
| GoogleChrome/modern-web-guidance-src | 5,170★，+1,925/天 | 浏览器厂商给编码 Agent 的现代 Web 指引 |
| Anthropic skills | 189,429★ | Agent Skills 生态规模 |
| obra/superpowers | 312,189★ | 观点鲜明的技能包 |
| claude-mem | 110,570★ | 解决编码 Agent 跨会话丢上下文 |
| github/spec-kit | 146,972★ | 规格驱动开发 CLI |
| JetBrains Thinkrail / Worktrunk / OpenBot，Block Buzz，meta/astryx | 多 Agent 工作区 / 每会话一 worktree | 多 Agent 并行是热方向 |
| ChromeDevTools/chrome-devtools-mcp | DevTools 给编码 Agent | Agent 驱动浏览器 / 调试 |
| shanselman/gputaskman | 3.1k★，+317/天 | 每进程 VRAM、GPU 活动、LLM 模型/KV-cache 洞察 |
| expo/exact | 4.1k★，+583/天 | 一次编写处处运行，Agent 可构建/运行/查看/测试 |
| libracoder/kiri | 2.4k★，+585/天 | 小而快的跨平台容器运行时 |
| aws/aws-emulator | +2,133/天，当日第 1 | 本地模拟 AWS API，每服务保真度评分 |
| uptime-kuma | 自托管监控 | 监控配置静默失效是老痛点 |
| Gentleman-Programming/gentle-ai | 9.1k★，+242/天 | 跨 Claude Code / Cursor / OpenCode / Codex 配置增强 Agent |
| tailscale/tailcat | 无账号的 WireGuard 版 netcat | 极简远程通道 |

## 2. 发散：22 个种子（痛点先行）

| # | 痛点（一句话） | 来源信号 |
|---|---|---|
| S01 | Agent 花 20 分钟“学会”一个仓库，画出的模块图里有根本不存在的 import 边；开发者照图改错模块，构建炸了 | rea / craft-anything |
| S02 | Agent 跨会话丢上下文，续写时把已解决的问题重做一遍 | claude-mem 110k★ |
| S03 | 同一份 diff、同一个 AI 评审，两次跑出不同结论，团队不敢信评审 | open-code-review |
| S04 | Agent 声称修好了某个 issue，PR 根本没碰到涉事代码路径 | open-code-review / codex-security |
| S05 | 多个 Agent 同一仓库并行，互相覆盖文件、合并冲突 | Thinkrail / Worktrunk / Buzz / astryx |
| S06 | MCP 服务器升级悄悄改了工具/参数，Agent 调用直接炸 | chrome-devtools-mcp |
| S07 | 本地跑大模型，VRAM/KV-cache 配多大全靠猜，OOM 才知道错了 | gputaskman |
| S08 | README 里写的命令/参数根本不存在（Agent 生成的 README 尤其爱撒谎） | 每个仓库都有 README |
| S09 | Agent 写的 CI workflow 一推就失败：触发器写错、权限缺失 | Turnkeep 自身 403 教训（2026-11-14） |
| S10 | 技能包泛滥（300k★ 级），两个技能给出矛盾指令 | superpowers / skills |
| S11 | 本地 AWS 模拟器测过了，上生产照样失败——模拟器与真实漂移 | aws-emulator 保真度评分 |
| S12 | 发布说明声称的改动根本不在 diff 里 | 每个仓库都发 release notes |
| S13 | Agent 交接摘要凭空编造源会话里没有的“事实” | 多会话 Agent 工作流 |
| S14 | Agent 驱动浏览器的操作无法重放，事后没法核验它到底点了什么 | agent-browser / chrome-devtools-mcp |
| S15 | Agent 插件升级后悄悄坏掉，锁文件与实际解析结果漂移 | 插件生态 |
| S16 | Agent 写的测试本身是 flaky 的（时序、顺序、共享状态） | Agent 写测试成常态 |
| S17 | Agent 把密钥粘进日志/PR 描述 | Agent 高频输出 |
| S18 | 监控配好了但静默不告警，出事才发现 | uptime-kuma |
| S19 | 容器运行时行为有细微差别，换运行时就炸 | kiri |
| S20 | Agent 一次 200k 上下文循环，账单事后才吓人 | Agent 长跑 |
| S21 | 规格说 X、代码做 Y，收敛循环声称一致其实不一致 | spec-kit |
| S22 | Agent 生成的迁移脚本不可逆、应用一半失败 | Agent 写迁移成常态 |

## 3. 聚类：5 类

| 簇 | 主题 | 种子 | 为什么重要（≤20 词） |
|---|---|---|---|
| A | Agent 的理解与记忆 | S01、S02、S13、S21 | Agent 声称知道的东西，到底是不是真的 |
| B | Agent 代码工作的核验 | S03、S04、S12、S22 | Agent 声称做完的工作，到底做没做 |
| C | Agent 工作区与契约 | S05、S06、S14、S15 | 多个 Agent 共用机器/仓库/工具不互相踩 |
| D | 本地运行成本与资源 | S07、S11、S18、S20 | 本地跑 Agent，别出意外账单与崩溃 |
| E | 产物的真实性 | S08、S09、S16、S17、S19 | Agent 产出的东西必须为真 |

## 4. 收敛：8 个候选（新颖性 / 可行性 / 数据 / 范围 / 影响 0–5；RICE：Reach 以千用户计，Impact 1–5，Confidence 无证据 ≤50%，Effort 0.55 人月 = 88h）

| ID | 候选 | 目标用户 | 新颖 | 可行 | 数据 | 范围 | 影响 | 总分 /25 | RICE | GitHub 传播 | 收购潜力 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C01 | RepoMapVerify 仓库地图核验仪 | 让 Agent 学仓库的开发者 | 5 | 4 | 5 | 5 | 4 | **23** | 581.8 | 4.8 | 4.6 |
| C02 | FixTrace 修没修核验仪 | 审 Agent PR 的开发者 | 4 | 4 | 4 | 5 | 5 | 22 | 436.4 | 4.6 | 4.5 |
| C03 | WorktreeGuard 多 Agent 写集隔离核验 | 并行跑多 Agent 的开发者 | 4 | 5 | 5 | 4 | 4 | 22 | 232.7 | 4.4 | 4.3 |
| C04 | MCPContractDiff MCP 工具契约漂移检查 | 接 MCP 的 Agent 开发者 | 4 | 5 | 5 | 4 | 3 | 21 | 261.8 | 4.5 | 4.0 |
| C05 | ContextSurvivor 上下文存活审计 | 长会话 Agent 用户 | 4 | 3 | 4 | 4 | 5 | 20 | 381.8 | 4.6 | 4.2 |
| C06 | VRAMPlanner 本地模型显存预算模拟器 | 本地跑大模型的开发者 | 3 | 5 | 5 | 3 | 3 | 19 | 147.3 | 4.0 | 3.6 |
| C07 | READMETruth README 声明核验 | 每个有 README 的仓库 | 4 | 5 | 5 | 5 | 3 | 22 | 490.9 | 4.3 | 3.4 |
| C08 | ReviewFlip AI 评审结论稳定性审计 | 用 AI 评审的团队 | 3 | 5 | 4 | 4 | 4 | 20 | 218.2 | 4.2 | 4.1 |

### 4.1 前 3 名排序理由

1. **C01 RepoMapVerify（23/25，RICE 581.8）**——rea 456k★ 是 AI 榜第 1，证明“Agent 学仓库”是当前最热的 Agent 用途；造地图的人人都在做，核地图的没人做；确定性核心最干净（静态 import 图 vs 声称边），S0 门可严格验证；README 价值一眼可懂。
2. **C02 FixTrace（22/25，RICE 436.4）**——“PR 到底修没修 issue”是每个审 Agent PR 的人每天的痛；但 issue 到代码路径的映射需要符号级静态分析 + issue 文本解析，确定性边界比 C01 脆弱。
3. **C07 READMETruth（22/25，RICE 490.9）**——受众最广（每个仓库都有 README），实现最容易；但痛点强度最低（README 腐烂很少直接导致生产事故），影响 3/5。

### 4.2 三透镜（一票否决）

| 候选 | 合意性 | 可行性 | 生存性 |
|---|---|---|---|
| C01 | PASS（rea 456k★ 证明需求；核验是缺失的一半） | PASS（确定性静态分析 + Python Oracle） | PASS（本地 CLI，零运行成本，MIT） |
| C02 | PASS | PASS（带解析边界说明） | PASS |
| C03 | PASS | PASS | PASS |
| C04 | PASS | PASS | PASS |
| C05 | PASS | 边缘：真实 LLM 压缩器无法确定性审计，只能核验确定性策略层，产品收窄 | PASS |
| C06 | 边缘：llama.cpp 已有估算；产品偏薄（计算器） | PASS | PASS |
| C07 | PASS | PASS | PASS |
| C08 | PASS | PASS | PASS |

### 4.3 淘汰清单

| 想法 | 淘汰原因 |
|---|---|
| S10 技能冲突检测 | 与 P023 SkillScope 作用域主题过近（技能来源 vs 技能内容），避重 |
| S09 CI workflow 权限模拟 | 与 P020 CheckPath（CI 门覆盖模拟）相邻；且 Turnkeep 403 已是已知解法 |
| S16 Agent 测试 flakiness 检测 | pytest-randomly 等已有成熟方案，新颖性不足 |
| S17 密钥泄漏扫描 | gitleaks / trufflehog 已成熟，新颖性不足 |
| S14 浏览器操作轨迹核验 | 与 P022 LocatorStress（浏览器定位确定性）同域，避重 |
| S18 监控覆盖模拟 | 实质是 CheckPath 的监控版，模式重复 |
| S15 插件锁文件核验 | npm audit / pip 锁文件审计的翻版，新颖性不足 |
| S20 Agent 成本估算 | 纯算术，产品太薄，S0 门无意义 |

## 5. 锁定

**LOCKED: C01 RepoMapVerify 仓库地图核验仪（P024）**

锁定理由：总分最高（23/25），RICE 最高（581.8），GitHub 传播与收购潜力双最高（4.8 / 4.6），三透镜全过，确定性核心最干净，与 P011–P023 均无重叠（P011 是对话上下文胶囊，P020 是 CI 门覆盖，P022 是浏览器定位，P023 是技能作用域；本项目是仓库静态 import 图核验）。

## 6. 禁做清单（避重，P001–P023）

- 不做技能作用域（P023）、CI 门覆盖（P020）、视口几何（P021）、定位器（P022）、对话上下文胶囊（P011）、求助搭桥卡（P016）。
- 旧项目只做避重排除，不做模板。
