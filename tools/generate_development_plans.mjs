import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const taskDir = path.join(root, 'docs', 'design', '02-subprojects', 'tasks');
const planDir = path.join(root, 'docs', 'design', '06-planning');
const modulePlanDir = path.join(planDir, 'modules');
fs.mkdirSync(modulePlanDir, { recursive: true });

const modules = [
  {
    id: 'P0',
    name: '统一契约与开发平台',
    tasks: [
      't0.1-monorepo-ci.md',
      't0.2-foundation-contracts.md',
      't0.3-entity-schemas.md',
      't0.4-event-schemas.md',
      't0.5-sdk-fixtures.md',
      't0.6-local-infra.md',
    ],
    depends: '无；P6 的策略 SDK 在本模块只使用契约替身',
    outputs: 'Monorepo、contracts/events/SDK、共享 Fixture、Compose、迁移和 CI 门禁',
    consumers: 'P1、P2、P3、P4、P6、P8',
    sequence: [
      'Wave 0A：T0.1、T0.2 建立仓库、基础类型、错误、分页、幂等和版本边。',
      'Wave 0B：T0.3、T0.4 并行冻结实体 Schema 与 Canonical Event。',
      'Wave 0C：T0.5 生成 SDK/Mock/Fixture，T0.6 建立 Compose 和 migration。',
      'Gate P0：所有 schema diff、SDK 编译、迁移预检和空环境健康检查通过。',
    ],
    data: 'tenant-demo/workspace-demo/project-continuity/workitem-webhook；合法/非法 Schema 样本；重复事件；空库、半迁移库和重复迁移库。',
    function:
      '从空目录安装依赖、生成 SDK、启动 Compose、运行迁移、发送合法和非法请求，确认错误封套、幂等和版本冲突行为。',
    acceptance:
      '下游只消费版本化契约、Fixture 和 SDK；Schema 不兼容在构建阶段阻断；所有 P0 产物都有 checksum、health/readiness/version 和独立报告。',
  },
  {
    id: 'P1',
    name: 'Plane 连接器与工作图谱',
    tasks: [
      't1.1-plane-version-matrix.md',
      't1.2-plane-rest-client.md',
      't1.3-webhook-security.md',
      't1.4-webhook-dedup-replay.md',
      't1.5-plane-projection.md',
    ],
    depends: 'P0；固定 Plane 版本、Mock Server 或专用测试实例',
    outputs:
      'Plane capability matrix、REST Client、Webhook 入口、去重/回放、Project/WorkItem observed projection',
    consumers: 'P2、P5、P7、P8',
    sequence: [
      'Wave 1A：T1.1 固定 Plane 版本和能力矩阵。',
      'Wave 1B：T1.2 与 T1.3 并行开发 REST 读取和 Webhook 验签入口。',
      'Wave 1C：T1.4 建立去重、重试、死信和回放；T1.5 消费稳定事件生成 projection。',
      'Gate P1：真实形状的 Project/WorkItem、重复/乱序/延迟 Webhook 和权限传播全部通过。',
    ],
    data: '两租户、两个 Project、多个 WorkItem、Cycle、Module、Label、Comment、Attachment、版本 1/2/3 和对应 Webhook。',
    function:
      '创建/更新/删除 Plane 对象，接收签名 Webhook，验证 projection revision、source_refs、event_id 去重和 cursor 回放。',
    acceptance:
      'Plane 是 project/work item 权威源；不读 Plane 内部数据库；重复事件 effect 为 0；projection 可由 object/version 回溯。',
  },
  {
    id: 'P2',
    name: '上下文、文件、记忆与 ContextPack',
    tasks: [
      't2.1-artifact-metadata.md',
      't2.2-memory-adapter.md',
      't2.3-context-layers.md',
      't2.4-context-compiler.md',
      't2.5-fts-resources.md',
    ],
    depends: 'P0；P1 projection Fixture；固定版本 ai-memory、隔离 Markdown wiki 和 SQLite 派生索引',
    outputs: 'ArtifactRef、MemoryRef、MemoryHit、L0–L4、ContextPack、FTS 和 MCP Resource',
    consumers: 'P3、P4、P5、P7、P8',
    sequence: [
      'Wave 2A：T2.1 与 T2.2 并行建立文件引用和 ai-memory Adapter。',
      'Wave 2B：T2.3 定义上下文层与确认状态，T2.4 编译确定性 ContextPack。',
      'Wave 2C：T2.5 暴露 FTS 和 MCP Resource，并验证分页/权限。',
      'Gate P2：ContextPack hash、来源、权限、budget、ai-memory 真源和恢复行为全部通过。',
    ],
    data: '已确认决策、未确认候选、风险、过期记忆、敏感附件、同名文件、多个 page revision、Markdown 真源和 SQLite rebuild。',
    function:
      'capture/recall/consolidate/handoff/claim/restore；按 scope 生成 ContextPack；用相同输入重复编译并比较 hash、source_refs 和截断原因。',
    acceptance:
      '正文由 ai-memory Markdown 管理，SQLite 只作派生索引；P2 不把 proposed 升级为 verified；越权不返回正文。',
  },
  {
    id: 'P3',
    name: '会话、检查点、交接与离线同步',
    tasks: [
      't3.1-session-model.md',
      't3.2-checkpoint-handoff.md',
      't3.3-sync-cursor-batch.md',
      't3.4-sqlite-outbox.md',
      't3.5-conflict-service.md',
    ],
    depends: 'P0 事件/错误；P2 ContextPack/MemoryRef；网络、Plane、ai-memory 替身',
    outputs:
      'Session、AgentRun、ToolCall、Checkpoint、Handoff、SyncCursor、SQLite Outbox、Conflict',
    consumers: 'P4、P5、P7、P8',
    sequence: [
      'Wave 3A：T3.1 定义 Session 状态机；T3.3/T3.4 并行实现 cursor 和 durable outbox。',
      'Wave 3B：T3.2 接入 ContextPack 生成 Checkpoint/Handoff/Resume。',
      'Wave 3C：T3.5 建立 409、ConflictDetected/Resolved 和人工解决路径。',
      'Gate P3：断网、重启、缺口、重复、claim-once 和并发冲突均有可重放证据。',
    ],
    data: '两个 client session、可 claim/已 claim handoff、离线 outbox、cursor 缺口、服务器版本变化和 protected fields。',
    function:
      'Codex 创建 Session 和 Checkpoint，生成 Handoff，Claude claim-once，断网写入，重启 drain，提交旧版本并进入 Conflict center。',
    acceptance:
      '交接只成功一次；outbox durable 无丢失；冲突不静默覆盖；Resume 重新执行权限过滤并保留来源。',
  },
  {
    id: 'P4',
    name: '统一 MCP、REST、CLI 与客户端连接器',
    tasks: [
      't4.1-api-gateway.md',
      't4.2-mcp-gateway.md',
      't4.3-workctx-cli.md',
      't4.4-client-adapters.md',
    ],
    depends: 'P0、P2、P3、P6；所有入口共享同一 WCP、Policy 和 Audit 路径',
    outputs: 'REST Gateway、MCP Resources/Tools/Prompts、workctx CLI、客户端 capability matrix',
    consumers: 'P5、P8',
    sequence: [
      'Wave 4A：T4.1 固定 WCP REST 错误/版本/审计路径；T4.2 映射 MCP Resources/Tools/Prompts。',
      'Wave 4B：T4.3 将 resume/checkpoint/handoff/sync 映射到 CLI。',
      'Wave 4C：T4.4 接入 Codex、Claude Code、DeepSeek、WorkBuddy capability 和切换。',
      'Gate P4：同一业务请求的 REST/MCP/CLI 结果和错误语义一致。',
    ],
    data: '同一业务请求的 REST、MCP、CLI transcript；允许/拒绝 scope；过期 token；多个 client capability。',
    function:
      '使用三个入口读取同一个 WorkItem Context、创建 Handoff、claim 和 Resume；比较字段、revision、source_refs、错误码和审计。',
    acceptance:
      '入口只转换协议，不复制领域规则；越权请求无下游副作用；客户端差异只体现为能力降级和格式。',
  },
  {
    id: 'P5',
    name: 'Web 工作台',
    tasks: [
      't5.1-workbench-query.md',
      't5.2-workbench-handoff-conflict.md',
      't5.3-workbench-admin.md',
    ],
    depends: 'P1、P2、P3、P4、P6 的公开查询/授权接口',
    outputs: '项目/工作项查询、Context、Handoff、Conflict、Admin、Playwright 和发布 Smoke',
    consumers: 'P8',
    sequence: [
      'Wave 5A：T5.1 使用 API stub 完成项目、WorkItem、Context 查询和所有 UI 状态。',
      'Wave 5B：T5.2 接入 Handoff/Resume/Conflict center，并验证双版本差异。',
      'Wave 5C：T5.3 接入管理、策略、审计、Connector 和发布健康。',
      'Gate P5：关键旅程、权限、错误态、可访问性和 Smoke 通过。',
    ],
    data: '两租户、多项目、两个 session、冲突对象、无权限、空数据、stale 数据和服务不可用状态。',
    function:
      '打开项目和 WorkItem、查看来源、claim/resume、解决冲突、查看审计和发布健康；检查浏览器缓存不越权。',
    acceptance:
      'UI 不拥有领域事实；所有操作经 P4/P6；loading/empty/error/stale/denied/conflict 状态均有可操作反馈。',
  },
  {
    id: 'P6',
    name: '安全、治理与观测',
    tasks: ['t6.1-identity-policy.md', 't6.2-audit-governance.md', 't6.3-observability.md'],
    depends: 'P0；Keycloak、OPA、OTel 使用隔离 Compose，其他模块使用 SDK 替身',
    outputs: 'Identity/RBAC/OPA、PolicyDecision、AuditRecord、分类/脱敏、Trace/Metrics/Logs/告警',
    consumers: 'P1、P2、P3、P4、P5、P7、P8',
    sequence: [
      'Wave 6A：T6.1 建立身份、租户/项目 scope 和 Policy SDK。',
      'Wave 6B：T6.2 建立审计、分类、留存、脱敏和导出；T6.3 并行接入 OTel 和告警。',
      'Wave 6C：将 P6 SDK 接入所有模块并执行 deny 无副作用回归。',
      'Gate P6：越权、副作用、审计完整性、脱敏、trace 和告警全部通过。',
    ],
    data: '两租户三角色、过期 token、scope escalation、敏感附件、审批记录、提示注入和 trace parent。',
    function:
      '允许/拒绝读取、写入、导出、恢复、删除和 Tool 调用；核对 audit 字段、trace graph、redaction 和 fail-closed。',
    acceptance:
      '所有敏感操作先 Policy 后执行、再 Audit；拒绝无副作用；关键操作可从 trace、日志、指标和审计关联。',
  },
  {
    id: 'P7',
    name: '搜索和智能能力',
    tasks: ['t7.1-golden-evaluation.md', 't7.2-intelligence-workers.md', 't7.3-search-vector.md'],
    depends: 'P1、P2、P3、P6 的只读/受控接口；模型和向量服务版本固定且可替换',
    outputs: 'Golden Dataset、EvaluationReport、Proposal、SearchHit、FTS/实体/链接/可选向量',
    consumers: 'P5、P8',
    sequence: [
      'Wave 7A：T7.1 固定 Golden Dataset、prompt、模型版本和评测指标。',
      'Wave 7B：T7.2 实现抽取/建议 Worker，始终输出 proposed；T7.3 实现 FTS 默认和可选向量。',
      'Wave 7C：执行 stale、来源、提示注入、人工审批和回归评测。',
      'Gate P7：阈值达标且 Feature Flag 仍默认关闭直到 RC。',
    ],
    data: '多阶段项目、过期事实、相似文件、未确认推断、冲突计划、提示注入和恶意附件。',
    function:
      '从 ContextPack/FTS 生成带 source_refs 的 SearchHit/Proposal；无审批不能 promotion；模型不可用时降级。',
    acceptance: '来源完整 ≥98%；下一步 ≥95%；过期混入 ≤2%；未确认误标 ≤1%；不自动修改 verified。',
  },
  {
    id: 'P8',
    name: '统一发布、质量与私有化交付',
    tasks: [
      't8.1-integration-e2e-resilience.md',
      't8.2-compose-helm.md',
      't8.3-release-rollback.md',
    ],
    depends: 'P0–P7 全部版本化 artifact、Schema、migration、Fixture、Feature Flag 和 Runbook',
    outputs: '集成/E2E/Resilience 编排、Compose/Helm、Release Manifest、SBOM、备份恢复和回滚',
    consumers: '生产环境、运维和发布审批',
    sequence: [
      'Wave 8A：T8.1 编排接口、E2E、故障、安全和性能测试；T8.2 固定 Compose/Helm 拓扑。',
      'Wave 8B：T8.3 生成 Release Manifest、SBOM、备份/恢复/回滚脚本。',
      'Wave 8C：clean install、升级、回滚、恢复和生产 Smoke 演练。',
      'Gate P8：所有模块报告、契约边、恢复证据和上线 Smoke 齐全。',
    ],
    data: 'clean install、上一版本 manifest、故障注入、Postgres/SQLite/ai-memory 备份、生产 Smoke tenant。',
    function:
      '从空目录部署，运行三条 E2E 链路，模拟 Plane/DB/Policy/ai-memory 故障，恢复和回滚后核对 event IDs、revision、hash 和 audit。',
    acceptance:
      'Manifest 可重放；回滚不丢事件、记忆和审计；SBOM/digest 对齐；生产 Smoke 和观测门禁通过。',
  },
];

const safe = (text) =>
  String(text ?? '')
    .replace(/\|/g, '／')
    .replace(/\r?\n/g, ' ')
    .trim();
const section = (text, heading) => {
  const match = text.match(new RegExp(`^## ${heading}\\r?\\n([\\s\\S]*?)(?=^## |\\z)`, 'm'));
  return match ? match[1].trim().replace(/\r?\n/g, ' ').replace(/\s+/g, ' ') : '';
};

const taskRecords = new Map();
for (const file of fs.readdirSync(taskDir).filter((x) => x.endsWith('.md') && x !== 'README.md')) {
  const content = fs.readFileSync(path.join(taskDir, file), 'utf8');
  taskRecords.set(file, {
    title: content.split(/\r?\n/)[0].replace(/^#\s*/, '').trim(),
    goal: section(content, '目标'),
    owner: section(content, '负责人和依赖'),
    output: section(content, '输出和接口'),
    test: section(content, '独立测试'),
  });
}

const testTaskRows = (module) => [
  [
    `DEV-${module.id}-01`,
    '独立单元/契约实现',
    '模块负责人',
    `实现 ${module.tasks.join('、')} 的正常、校验、幂等、版本和错误路径`,
    '模块任务完成且公开契约已冻结',
    `pnpm run test:module -- ${module.id} --isolated`,
    '单元和契约报告，失败路径必须先于实现提交',
  ],
  [
    `DATA-${module.id}-01`,
    '真实形状数据模拟',
    'Fixture/测试负责人',
    module.data,
    'P0 Fixture 版本和 scope 模型可用',
    `pnpm run fixture:seed -- --module ${module.id}`,
    'seed.json、数据 hash、权限矩阵和清理报告',
  ],
  [
    `FUNC-${module.id}-01`,
    '功能闭环校验',
    '模块负责人',
    module.function,
    '模块公开接口和替身依赖可启动',
    `pnpm run test:functional -- --module ${module.id}`,
    '功能 transcript、状态 diff、trace 和 source_refs',
  ],
  [
    `FAULT-${module.id}-01`,
    '故障/恢复校验',
    '韧性测试负责人',
    '注入超时、重复、乱序、断网、重启或上游不可用，按模块边界选择适用场景',
    '正常功能通过且故障开关可控',
    `pnpm run test:resilience -- --module ${module.id}`,
    'failure report、replay/restore 证据和副作用检查',
  ],
  [
    `SEC-${module.id}-01`,
    '权限和敏感数据校验',
    'P6/模块安全负责人',
    '覆盖跨租户、跨项目、过期 token、scope escalation、脱敏和提示注入',
    'P6 Policy SDK/替身可用',
    `pnpm run test:security -- --module ${module.id}`,
    'deny decision、audit、side-effect diff',
  ],
  [
    `PERF-${module.id}-01`,
    '性能和容量校验',
    '性能测试负责人',
    '用固定数据量、并发度、预算和超时阈值验证 p95、队列积压、内存和有界重试',
    '功能和观测指标已接入',
    `pnpm run test:performance -- --module ${module.id}`,
    'performance report、metrics snapshot',
  ],
  [
    `EVID-${module.id}-01`,
    '集成交付证据',
    '模块负责人/发布组',
    '归档版本、digest、Schema diff、Fixture、health/readiness/version、测试报告和回滚步骤',
    '所有本模块测试通过',
    `pnpm run evidence:bundle -- --module ${module.id}`,
    'module verification report + release handoff',
  ],
];

for (const module of modules) {
  const rows = module.tasks
    .map((file) => {
      const task = taskRecords.get(file) ?? {};
      const link = `../../02-subprojects/tasks/${file}`;
      return `| [${safe(task.title || file)}](${link}) | ${safe(task.goal)} | ${safe(task.owner)} | ${safe(task.output)} | ${safe(task.test)} |`;
    })
    .join('\n');
  const tests = testTaskRows(module)
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n');
  const doc = `# ${module.id} ${module.name} 开发计划

> 本文件是 ${module.id} 的独立开发计划。模块可以在替身依赖下并行推进，但必须完成本文的开发任务、真实形状数据模拟、功能校验和交付证据，才能进入统一集成。

## 1. 目标、边界和依赖

- **目标：** ${module.outputs}。
- **前置依赖：** ${module.depends}。
- **下游协接方：** ${module.consumers}。
- **公共约束：** 所有写入携带幂等键和版本条件；所有响应和事件带 scope、trace_id、revision/version、source_refs；所有敏感操作经过 P6 Policy/Audit。
- **模块测试门禁：** [${module.id} 独立测试校验](../../04-testing/modules/${module.id}-independent-verification.md)。
- **模块协接契约：** [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#${module.id})。

## 2. 子任务开发清单

| 子任务 | 目标 | 负责人/依赖 | 输出 | 独立测试重点 |
|---|---|---|---|---|
${rows}

每个子任务必须按固定顺序执行：确认输入契约 → 编写失败测试 → 验证失败 → 实现最小行为 → 运行独立测试 → 更新 Schema/Fixture/追踪矩阵 → 生成版本化交付包。子任务不得直接调用其他任务内部类、数据库或本地文件。

## 3. 开发波次和并行边界

${module.sequence.map((item) => `- ${item}`).join('\n')}

同一波次内的任务只能共享 P0 公开契约和 Fixture；需要修改公共字段时先更新协接契约和消费方测试，再继续实现。每个波次结束保存一次可恢复的测试环境和变更清单。

## 4. 测试计划任务

这些任务是本模块开发计划的一部分，不能只在发布阶段临时补做。

| 测试计划任务 | 类型 | 责任人 | 工作内容 | 前置条件 | 标准命令 | 完成证据 |
|---|---|---|---|---|---|---|
${tests}

## 5. 真实形状数据模拟

### 5.1 数据范围

${module.data}

数据必须是合成数据，但字段、对象关系、版本变化、权限边界、错误比例和事件顺序要保持生产形状。每份 Fixture 记录 \`fixture_version\`、\`seed\`、scope、初始 revision、数据分类和清理策略；禁止使用生产导出的个人信息、真实 token、真实附件或未审查的 memory 正文。

### 5.2 模拟步骤

1. 创建隔离 tenant/workspace/project scope 和三个角色；
2. 按模块输入顺序 seed 事实、版本、事件、文件、memory、session 或发布物；
3. 记录每个对象的 authority、revision、source_ref、classification 和 expected effect；
4. 执行正常、重复、乱序、缺失、越权、超时和恢复场景；
5. 比较状态、事件、outbox、audit、trace、hash 和下游输出；
6. 清理环境并验证无跨租户、无明文 secret、无悬挂任务和无未归档证据。

### 5.3 数据通过条件

- 相同 seed 在同一 manifest 下产生相同对象 ID、revision 和初始 hash；
- 所有模拟写入可由 event_id、trace_id 和 source_refs 反向定位；
- 失败和拒绝请求的权威状态、事件、outbox、memory page 和审计副作用符合契约；
- Fixture 能在独立模块环境和统一集成环境中重复使用。

## 6. 功能校验和协接交付

功能校验必须覆盖本模块的主路径、边界路径和恢复路径；不能只检查 HTTP 200 或页面显示。每条校验记录输入版本、输出版本、scope、trace_id、event IDs、revision/hash 和副作用检查。

进入集成前必须交付：

- 模块镜像/包和 immutable digest；
- Schema/API/Event/MCP diff；
- Fixture、Mock/Compose 配置和 seed 说明；
- health/readiness/version、migration 和配置结果；
- 独立测试、契约测试、真实形状数据模拟和功能校验报告；
- 失败场景、已知限制、Feature Flag、回滚和下游影响；
- 受影响的 \`IF-*\` 协接编号和下游确认记录。

## 7. 模块完成定义

- [ ] 所有子任务完成并在任务文档中记录实际输出；
- [ ] 正常、失败、权限、重复、版本冲突和恢复测试通过；
- [ ] 真实形状 Fixture 可重复 seed、校验和清理；
- [ ] 功能校验能关联 trace、event、revision/hash 和 source_refs；
- [ ] 模块独立测试文档的门禁全部通过；
- [ ] 提供方/消费方契约测试已运行；
- [ ] Release Manifest、回滚和运行手册输入齐全；
- [ ] 模块负责人签署验证报告后才可合并到 \`develop\`。
`;
  fs.writeFileSync(path.join(modulePlanDir, `${module.id}-development-plan.md`), doc, 'utf8');
}

const allTaskRows = modules
  .flatMap((module) =>
    module.tasks.map((file) => {
      const task = taskRecords.get(file) ?? {};
      return `| ${module.id} | [${safe(task.title || file)}](modules/${module.id}-development-plan.md) | [任务设计](../02-subprojects/tasks/${file}) | ${safe(task.goal)} | ${safe(task.test)} |`;
    }),
  )
  .join('\n');

const overall = `# Plane Work Continuity Platform 整体开发计划

> 本文件是 P0–P8 的统一执行计划。它把模块开发、37 个子任务、真实形状数据模拟、功能校验、契约协接、集成、发布和回滚放在同一条可审计链路中。

## 1. 目标和完成判定

目标是交付一个以 Plane 事实为权威、以 ai-memory Markdown 为长期记忆真源、以 ContextPack 为跨客户端上下文、以 Session/Handoff/Outbox/Conflict 支撑连续工作的私有化平台。完成必须同时满足：

- P0–P8 的模块计划和全部子任务均有负责人、依赖、输出、测试和交付证据；
- 每个模块先独立通过测试和真实形状数据模拟，再通过提供方/消费方契约测试；
- 统一集成环境能跑通 Plane→Webhook→Projection→ContextPack→MCP、跨客户端切换、离线冲突三条链路；
- Release Manifest 固定所有 artifact、Schema、migration、Plane、ai-memory、模型和 Feature Flag；
- 备份恢复、升级回滚、SBOM、观测和生产 Smoke 全部通过。

## 2. 模块计划入口

${modules.map((module) => `- [${module.id} ${module.name}](modules/${module.id}-development-plan.md)：${module.outputs}`).join('\n')}

## 3. 整体开发波次

| 波次 | 范围 | 并行关系 | 退出条件 |
|---|---|---|---|
| Wave 0：基线和契约 | P0 / T0.1–T0.6 | P0 内按契约→Fixture→Compose 顺序 | Schema、Event、SDK、Fixture、迁移和 CI 全绿 |
| Wave 1：事实与记忆 | P1、P2、P6 的独立能力 | P1/P2/P6 可在替身下并行；公共字段只能经 P0 | Plane projection、ContextPack、Policy/Audit/Trace 独立报告 |
| Wave 2：状态连续性 | P3 / T3.1–T3.5 | P3 依赖 P2 ContextPack 契约 | claim-once、outbox、cursor、冲突和恢复全绿 |
| Wave 3：统一入口 | P4 / T4.1–T4.4 | REST/MCP/CLI 可并行，共享 WCP/Policy | parity、MCP conformance、客户端切换通过 |
| Wave 4：产品和智能 | P5、P7 | P5 使用 Gateway stub；P7 使用 Golden/模型 stub | UI 关键旅程、Golden 阈值、proposal 审批通过 |
| Wave 5：统一集成 | P8 / T8.1–T8.3 | 依赖全部上游 immutable artifact | E2E、故障、性能、安全、恢复、回滚和 Smoke 通过 |

## 4. 37 个子任务完整计划

下表是整体计划的任务基线；每个任务的详细设计和独立测试仍以 \`docs/design/02-subprojects/tasks/\` 下的文件为准，每个模块的执行顺序以 \`modules/P*-development-plan.md\` 为准。

| 模块 | 任务归属 | 任务设计 | 目标 | 独立测试重点 |
|---|---|---|---|---|
${allTaskRows}

## 5. 跨模块测试和真实数据计划

- [统一真实数据和功能校验计划](03-test-data-and-functional-validation-plan.md)：Fixture、seed、场景、校验任务、证据和清理。
- [模块独立测试目录](../04-testing/modules/README.md)：P0–P8 独立测试矩阵和门禁。
- [模块接口与协接契约](../03-integration/04-module-interface-contracts.md)：公共上下文、错误、版本和 28 条直接依赖边。
- [模块契约测试矩阵](../03-integration/05-module-contract-test-matrix.md)：提供方/消费方双侧校验。
- [集成测试主链路](../03-integration/03-end-to-end-chains.md)：三条端到端链路。

## 6. 集成和发布顺序

1. P0 发布 Schema/SDK/Fixture/Compose 版本；
2. P1、P2、P6 发布独立能力和契约报告；
3. P3 接入 ContextPack、MemoryRef、Session、Handoff、Outbox 和 Conflict；
4. P4 接入 REST/MCP/CLI/客户端适配并执行 parity；
5. P5 接入真实 Gateway，P7 接入 Golden/FTS/模型受控能力；
6. P8 创建临时集成环境，运行三条 E2E 和所有故障/安全/性能场景；
7. 生成 Release Manifest、SBOM、备份和回滚证据；
8. RC 和生产 Smoke 通过后才打开 Feature Flag。

任何接口、事件、权限、Schema、migration、Fixture 或 Feature Flag 改动，都必须暂停下游合并，更新 \`requirements-matrix.yaml\`、受影响模块计划、\`IF-*\` 契约和双侧测试。

## 7. 整体 Gate 和证据

| Gate | 必须通过 | 证据 |
|---|---|---|
| G0 契约冻结 | Schema/Event/API/MCP/SDK、版本和 Fixture | contract diff、compile、fixture report |
| G1 模块完成 | P0–P8 独立测试、数据模拟、功能校验 | module verification report |
| G2 协接可用 | 所有受影响 \`IF-*\` provider/consumer 测试 | edge reports、trace、failure cases |
| G3 集成稳定 | 三条 E2E、重复/乱序/断网/重启/冲突/越权 | JUnit、event IDs、ContextPack hash、audit IDs |
| G4 发布候选 | clean install、迁移、SBOM、恢复、回滚、性能 | manifest、restore/rollback/performance report |
| G5 生产上线 | health/readiness/version、Smoke、事件 lag、审计和 Resume | production smoke bundle |

## 8. 总体完成定义

- [ ] 9 份模块开发计划已评审；
- [ ] 37 个子任务全部出现在本计划并链接到详细设计；
- [ ] 每个子任务有独立测试、真实形状数据、功能校验和交付证据；
- [ ] P0–P8 模块计划的依赖和整体波次一致；
- [ ] 需求、设计、任务、测试、协接和发布物可通过编号或路径互相追踪；
- [ ] 所有 Gate 证据归档后，才允许标记整体计划完成。
`;
fs.writeFileSync(path.join(planDir, '00-overall-development-plan.md'), overall, 'utf8');

const globalTestTasks = [
  [
    'TEST-001',
    'Fixture Schema 和版本',
    'P0 Fixture 组',
    'P0 Schema/SDK',
    'pnpm run fixture:validate',
    '`fixture-schema-v1`、seed 校验器',
    '非法数据在 seed 前拒绝',
  ],
  [
    'TEST-002',
    'Plane 真实形状 seed',
    'P1 测试组',
    'P0、P1 Mock',
    'pnpm run fixture:seed -- --fixture plane-real-shape',
    'Project/WorkItem/Webhook 数据包',
    'object/version/source_ref 可回溯',
  ],
  [
    'TEST-003',
    'ai-memory 真实形状 seed',
    'P2 测试组',
    'P0、固定 ai-memory',
    'pnpm run fixture:seed -- --fixture memory-real-shape',
    'Markdown pages、revision、SQLite rebuild',
    '真源/派生索引 hash 可核对',
  ],
  [
    'TEST-004',
    'ContextPack Golden seed',
    'P2/P7 测试组',
    'P1、P2',
    'pnpm run fixture:seed -- --fixture context-golden',
    'L0–L4、过期、候选、风险数据',
    '相同 seed 生成相同 pack hash',
  ],
  [
    'TEST-005',
    'Session/交接 seed',
    'P3 测试组',
    'P2、P3',
    'pnpm run fixture:seed -- --fixture session-handoff',
    '两客户端 session、checkpoint、handoff',
    'claim-once 和 resume 输入完整',
  ],
  [
    'TEST-006',
    '权限和治理 seed',
    'P6 测试组',
    'P0、P6',
    'pnpm run fixture:seed -- --fixture governance',
    '两租户三角色、分类、审批',
    '每个用例都有 allow/deny 预期',
  ],
  [
    'TEST-007',
    '事件故障生成器',
    'P1/P3 韧性组',
    'P0、P1、P3',
    'pnpm run fixture:events -- --scenario duplicate-gap-delay',
    'duplicate、out-of-order、gap、delay 数据',
    '可按 seed 重放且 event IDs 可追踪',
  ],
  [
    'TEST-008',
    '备份和恢复样本',
    'P8 发布测试组',
    'P2、P3、P8',
    'pnpm run fixture:backup -- --manifest <digest>',
    'Postgres/SQLite/Markdown/Manifest 备份',
    '恢复后 revision/hash/event IDs 一致',
  ],
  [
    'TEST-009',
    '模块单元/契约门禁',
    '各模块负责人',
    '各模块任务',
    'pnpm run test:module -- <P> --isolated',
    'JUnit、contract diff、失败样本',
    '必选测试全绿，失败退出码非零',
  ],
  [
    'TEST-010',
    '功能主路径校验',
    'P1–P4 集成组',
    'P1–P4',
    'pnpm run test:e2e -- --chain plane-to-mcp',
    'Plane→ContextPack→MCP transcript',
    '输出带来源、权限和 revision',
  ],
  [
    'TEST-011',
    '跨客户端切换校验',
    'P3/P4 集成组',
    'P3、P4',
    'pnpm run test:e2e -- --chain client-switch',
    'Codex→Claude→WorkBuddy transcript',
    'claim-once、Resume、写回和审计通过',
  ],
  [
    'TEST-012',
    '离线/冲突校验',
    'P3 韧性组',
    'P3',
    'pnpm run test:resilience -- --scenario offline-conflict',
    'outbox、重启、409、Conflict report',
    '无丢失、无静默覆盖、可人工解决',
  ],
  [
    'TEST-013',
    'UI 旅程校验',
    'P5 前端测试组',
    'P4、P5、P6',
    'pnpm run test:e2e -- --suite workbench',
    'Playwright、axe、错误态截图',
    '关键旅程、租户隔离和可访问性通过',
  ],
  [
    'TEST-014',
    '智能 Golden 回归',
    'P7 评测组',
    'P2、P6、P7',
    'pnpm run test:evaluation -- --dataset golden-context',
    'EvaluationReport、人工抽样',
    '来源 ≥98%、下一步 ≥95%、过期 ≤2%',
  ],
  [
    'TEST-015',
    '故障恢复校验',
    'P8 韧性组',
    'P8',
    'pnpm run test:resilience -- --scenario dependency-down',
    'Plane/DB/Policy/ai-memory down/up 报告',
    'retryable、fail-closed、恢复可重放',
  ],
  [
    'TEST-016',
    '性能和容量校验',
    'P8 性能组',
    'P6、P8',
    'pnpm run test:performance -- --profile release',
    'p95、backlog、内存、预算报告',
    'Resume ≤5s、projection ≤3s、ack ≤1s',
  ],
  [
    'TEST-017',
    '发布和回滚校验',
    'P8 发布组',
    'P8',
    'pnpm run test:release -- --scenario restore-rollback',
    'install/upgrade/restore/rollback/SBOM',
    'manifest 可重放且无数据丢失',
  ],
  [
    'TEST-018',
    '证据归档和追踪',
    '测试与发布组',
    '全部模块',
    'pnpm run evidence:bundle -- --run-id <uuid>',
    'test manifest、trace bundle、requirements links',
    '每个失败/成功可定位到任务和协接边',
  ],
];
const globalTestRows = globalTestTasks.map((row) => `| ${row.join(' | ')} |`).join('\n');
const testPlan = `# 统一测试、真实数据模拟与功能校验计划

## 1. 目的

本计划把“测试代码怎么写、真实形状数据怎么造、功能是否真的工作、失败后怎么证明没有副作用”拆成可独立执行的计划任务。数据使用合成值，但保留生产对象关系、版本、权限、事件顺序和故障形状。

## 2. 共享数据域

| 数据域 | 模拟内容 | 权威来源 | 关键校验 |
|---|---|---|---|
| Plane | tenant、workspace、project、work item、cycle、module、label、comment、attachment、revision | Plane | Webhook 验签、projection、source_refs、权限 |
| Memory | Markdown wiki page、revision、SQLite FTS 派生索引、capture/recall/handoff | ai-memory Markdown | Markdown 真源、SQLite 可重建、claim-once、restore |
| Context | L0–L4、决策、风险、候选、过期内容、budget | WorkMesh compiler | 权限、hash、来源、截断、proposed/verified |
| Session | client、session、agent run、tool call、checkpoint、handoff | WorkMesh | 状态机、父子关系、resume、claim |
| Sync | event、cursor、outbox、duplicate、gap、conflict | Event/SQLite/Postgres | 幂等、replay、零丢失、409 |
| Governance | tenant/role/scope、classification、approval、audit、trace | P6 | deny 无副作用、脱敏、审计完整、trace 关联 |
| Release | image digest、Schema、migration、flag、backup、SBOM | P8 Manifest | 可重放、恢复、回滚、版本一致 |

## 3. 测试计划任务

| 任务 ID | 任务 | 责任人 | 前置条件 | 标准命令 | 产出 | 通过条件 |
|---|---|---|---|---|---|---|
${globalTestRows}

## 4. 标准模拟运行

\`\`\`powershell
pnpm run fixture:validate
pnpm run fixture:seed -- --fixture tenant-demo --version 1
pnpm run test:module -- P2 --isolated
pnpm run test:contract -- --edge IF-P2-P3
pnpm run test:e2e -- --chain plane-to-mcp
pnpm run test:e2e -- --chain client-switch
pnpm run test:resilience -- --scenario offline-conflict
pnpm run evidence:bundle -- --run-id <uuid>
\`\`\`

命令名称由 T0.1/T0.5 暴露；如果实现技术栈不同，必须保持语义、参数、退出码和证据目录兼容，不得让每个模块自定义不可组合的命令。

## 5. 功能校验的共同断言

- 权威事实仍由 Plane 或 ai-memory Markdown 管理；
- \`proposed\`、\`observed\`、\`verified\` 状态不可被智能 Worker 或客户端静默转换；
- 拒绝、重复、超时和版本冲突不产生未声明副作用；
- ContextPack 和 MemoryHit 始终包含来源、revision/hash、scope 和 classification；
- 事件、审计、outbox、数据库和 UI 显示都能通过 trace_id 关联；
- 恢复、回滚和重放后，结果可以由 manifest、event IDs 和 hash 重建。

## 6. 计划任务完成定义

- [ ] 每个 TEST-* 都有 owner、依赖、命令、Fixture、输出和阈值；
- [ ] 每个 P0–P8 计划至少引用一个真实数据、功能、故障、安全和性能任务；
- [ ] 所有模拟数据可重复、可清理、无真实敏感信息；
- [ ] 测试结果被 \`requirements-matrix.yaml\`、模块报告和 Release Manifest 引用；
- [ ] 集成和上线只消费已归档的测试证据，不接受口头通过。
`;
fs.writeFileSync(
  path.join(planDir, '03-test-data-and-functional-validation-plan.md'),
  testPlan,
  'utf8',
);

const readme = `# 开发计划目录

本目录把整体计划、P0–P8 模块计划和统一测试/真实数据/功能校验计划集中维护。设计基线、任务详细设计、独立测试、协接契约和发布手册仍是本计划的约束来源。

## 计划入口

- [整体开发计划](00-overall-development-plan.md)：波次、37 个子任务、统一 Gate 和整体完成定义。
- [统一测试、真实数据模拟与功能校验计划](03-test-data-and-functional-validation-plan.md)：TEST-001–TEST-018。

## 模块计划

${modules.map((module) => `- [${module.id} ${module.name}](modules/${module.id}-development-plan.md)`).join('\n')}

## 计划维护规则

- 新增、删除或拆分子任务时，必须同时更新整体计划、所属模块计划、任务索引、测试计划和追踪矩阵。
- 任务的实际输出、测试命令、Fixture 版本、协接边和完成证据发生变化时，必须在同一提交更新对应计划。
- 计划只描述可执行步骤和证据；具体字段和接口以 \`01-contracts\`、\`03-integration\` 和任务设计为准。
`;
fs.writeFileSync(path.join(planDir, 'README.md'), readme, 'utf8');
console.log(`Generated overall plan, ${modules.length} module plans and unified test/data plan.`);
