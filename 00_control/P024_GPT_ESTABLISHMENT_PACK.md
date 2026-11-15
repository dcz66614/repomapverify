# P024 GPT 立项包（给主聊天浏览器任务用，2026-11-14 ~13:12 GMT）

> 本子代理无浏览器，无法在 ChatGPT 新开对话。以下步骤与消息由主聊天执行。
> 规格已写好并核实（见 00_control/P024_SPEC_VERIFICATION.md），Drive 已归档；GPT 对话的作用是独立立项确认：让 GPT 从 GitHub 趋势独立构思、打分、锁定，并确认/修正本规格。

## 执行步骤

1. 在 ChatGPT 的自定义 GPT agent-project-automatic（g-p-6ade5013e8ec8191b55dca46c27772e1）里新开会话，标题改为 **P024-RepoMapVerify**。
2. 发送前手动核查模型与思考强度：立项用 **GPT-6 Pro**（每月 15 次额度内）；若 Pro 显示 Locked / 不可用，改用 **GPT-6 + Extra High（极高）**。不要默认上次设置还在。
3. 把下面“立项消息（直接粘贴用）”整段粘贴发送（结尾句已在内，不要重复加）。
4. 若 GPT 说读不到 Drive 文件，不得假装它读到了：把 `01_spec/PROJECT_BOOK.md` 与 `01_spec/IMPLEMENTATION_PLAN.md` 全文粘贴进对话，或作为文件单独上传为来源，再让它确认。
5. GPT 回复后：核对它锁定的方向是否与本记录一致（C01 RepoMapVerify）；若 GPT 锁定了别的候选且理由更强，以 GPT 的为准并更新规格；若一致，视为立项确认，规格 ACCEPTED，可等 Sam 授权派发 T001。

## Drive 链接（供 GPT 项目来源 / 阅读）

- 项目文件夹 P024-repomapverify：id `1E8p_0RB6Dm3cajWqcUe25qmpRWc1sLLW`
- 00_spec：id `1w_yE-Jpk_AQuZ7cOhtaSLpx28ynCoN1X`
- PROJECT_BOOK.md：id `1WTIQMcpfarVr_stfQ7nWAQiDdqYA-eav`，25,947 B，sha256 `117b978476070d19f1deb9fca1f69be5c5f63f87a4caf34c763ba8c7783433e5`
- IMPLEMENTATION_PLAN.md：id `1LfqN8WwheL1kdtBTbYbdYhuQgWWVo4w5`，15,886 B，sha256 `14595915fb74bd09f9fc121a53f1113ac8ff7c0a1b1e7a610e5bab06b4a41199`

## 立项消息（直接粘贴用）

```
你是资深产品经理 + 用户研究员。请为日常使用 AI 助手的开发者构思新项目（P024 立项），目标是解决开发者在使用 AI 编码 Agent 时的真实痛点，而不是展示新技术。

铁律：痛点先行，技术后行。每个想法先写痛点，再写机制；禁止以技术名词开头。不要因为之前做过的项目而干扰思考，思维发散一点。

背景（2026-11-14 GitHub Trending 实况，供参考，不作唯一来源；请你自己再大量搜索 GitHub 热门项目、论坛、论文、实时热点验证）：
- morluto/rea（456,439★，+2,111/天，AI 榜第 1）：“把 Agent 指向任何应用，了解它如何工作”。
- storytold/craft-anything（31.7k★，+1,331/天）：“理解任何软件如何工作，再自己造”。
- alibaba/open-code-review（50,981★，当日第 1）：AI 代码评审，确定性流水线 + LLM Agent。
- openai/codex-security（13,320★，+751/天）：找漏洞、修漏洞的 CLI + SDK。
- Anthropic skills（189,429★）、obra/superpowers（312,189★）：Agent 技能生态规模。
- claude-mem（110,570★）：解决编码 Agent 跨会话丢上下文。
- 多 Agent 工作区热：Thinkrail / Worktrunk / OpenBot、Block Buzz、meta/astryx。
- 本地推理与 GPU 可见性热：gputaskman（每进程 VRAM、KV-cache 洞察）、FreeToken、colibri。
- aws/aws-emulator（+2,133/天）：本地模拟 AWS API，每服务保真度评分。

流程：先发散 ≥20 个 → 聚 5 类 → 输出 ≥8 个候选；机制互不重复，优先小工具 / 小实验，禁止大平台式空泛想法。
每个候选必填：目标用户（具体的人）/ 场景（何时何地何设备）/ 痛点（频率 + 强度 1–5 + 每次代价 + 当前 workaround 及其不足）/ 核心机制（1–2 句）/ 最接近已有方案 + 不同点（无不同点自动降级）/ 可行性（技能 / 数据 / 成本 / 隐私）/ 最小验证实验 + 度量指标 / 风险与最大反对意见。
评分：新颖性 / 可行性 / 数据 / 范围 / 影响 0–5 分 + RICE（Confidence 无证据不得高于 50%）；三透镜（合意性 / 可行性 / 生存性）任一不过关即淘汰；另把“GitHub 传播力与被收购潜力”作为加分项单独打分。
约束：零真人参与（验证全部合成/自动化）；许可证 MIT；总预算 88 小时（72h + 16h 缓冲）；单人 2 周可出原型；数据默认本地优先；敏感信息须可查看、可改、可删；不做医疗诊断与金融建议。
禁做清单（已做过，避重）：技能作用域（P023）、CI 门覆盖模拟（P020）、视口几何（P021）、浏览器定位器（P022）、对话上下文胶囊（P011）、求助搭桥卡（P016）。

我方已做的一版构思（供你验证或推翻，不要只顺着它说）：锁定 C01 RepoMapVerify 仓库地图核验仪——一条命令核验 Agent 声称的仓库地图是真是假（凭空捏造的 import 边、错入口、漏掉的关键模块），真实 import 图作 ground truth，Python/TypeScript/Go 三语言，独立 Python Reference Oracle，S0 硬门 48 fixture（3 语言 × 16，8 控制 + 8 植入），48/48 Oracle parity，24/24 植入检出，0/24 控制误报，100 次重放 1 hash；总分 23/25，RICE 581.8，传播 4.8，收购 4.6。完整规格已写好（PROJECT_BOOK.md + IMPLEMENTATION_PLAN.md，见 Drive 文件夹 P024-repomapverify/00_spec；若读不到请告诉我，我把全文粘贴给你）。

请输出：一张统一表格 + 前 3 名排序理由 + 淘汰清单（想法 + 原因）+ 锁定一个方向 + 对我方规格的确认或修正意见（逐条列出要改的地方；若无需修改请明确说“规格确认无修改”）+ 该方向的第一周动手步骤。
禁语：“所有人”“提升体验”“效率低”——出现即要求重写为具体人、具体场景、可量化痛点。

请使用谷歌云盘以及任何需要的插件，如果有了的话就算了。
```
