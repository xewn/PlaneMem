import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputDir = path.join(root, 'docs', 'design', '04-testing', 'modules');
fs.mkdirSync(outputDir, { recursive: true });

const commonInvariants = [
  '所有输出含 `schema_version`、`trace_id`、scope、revision/version 和 `source_refs`。',
  '所有写入带 `Idempotency-Key` 和 `expected_version`/`If-Match`，重复请求的 effect 数为 0。',
  'Policy deny、Schema 不兼容和校验失败不产生事件、投影、审计正文或其他副作用。',
  '事件只追加不覆盖，消费者记录 `event_id` 和 aggregate version。',
  '失败必须能区分 retryable/non-retryable，并可由 trace_id 定位。',
  '测试证据中不得出现明文 secret、跨租户正文或未经授权的附件。',
];

const modules = [
  {
    id: 'P0',
    name: '统一契约与开发平台',
    tasks: 'T0.1–T0.6',
    requirements: 'R-005、R-010、R-011',
    scope:
      'Monorepo、基础类型、JSON Schema、Canonical Event、生成 SDK、共享 Fixtures、Compose、迁移和 CI 门禁',
    dependencies: '无。所有外部能力必须使用本模块的 Mock、Fixture 或本地 Compose 替身',
    fixtures:
      'tenant-demo/workspace-demo/project-continuity、最小事件样本、Schema 兼容样本、空库/已有库迁移样本',
    outputs: 'contracts 包、events 包、SDK、Fixture 版本、Compose 健康结果、迁移报告',
    threshold:
      'Schema 兼容性 100%；生成 SDK 编译 100%；迁移 up/down 100%；健康检查全绿；任何契约破坏都必须阻断构建',
    tasksFiles: [
      't0.1-monorepo-ci.md',
      't0.2-foundation-contracts.md',
      't0.3-entity-schemas.md',
      't0.4-event-schemas.md',
      't0.5-sdk-fixtures.md',
      't0.6-local-infra.md',
    ],
    cases: [
      [
        'P0-U01',
        '单元',
        '基础元数据校验',
        '缺少 tenant/workspace/project、schema_version 或 trace_id',
        '返回 VALIDATION_ERROR 且不生成副作用',
        'JUnit + request snapshot',
      ],
      [
        'P0-U02',
        '单元',
        '错误封套稳定性',
        '同类错误使用不同入口',
        'error.code、message、retryable、trace_id 字段保持一致',
        'JSON snapshot',
      ],
      [
        'P0-U03',
        '单元',
        '幂等和并发',
        '重复 Idempotency-Key 或落后 expected_version',
        '重复请求只有一个 effect；落后版本返回 409 且不写入',
        'effect counter + database diff',
      ],
      [
        'P0-U04',
        '单元',
        '时间和版本格式',
        '非 UTC 时间、非法 ULID、负分页和未知枚举',
        '校验拒绝并保持错误码稳定',
        'validation corpus',
      ],
      [
        'P0-C01',
        '契约',
        'JSON Schema/AsyncAPI',
        '当前 schema 与上一版本的合法、缺字段、未知字段样本',
        '兼容矩阵通过；破坏性变更阻断构建',
        'schema/event diff',
      ],
      [
        'P0-C02',
        '契约',
        'Canonical Event',
        '合法、缺字段、未知字段、重复事件',
        '合法样本通过；非法样本拒绝；重复不产生副作用',
        'AsyncAPI report',
      ],
      [
        'P0-C03',
        '契约',
        '生成 SDK',
        'SDK 与 HTTP fixture 双向序列化',
        '字段、枚举、错误码和分页一致',
        'SDK parity report',
      ],
      [
        'P0-I01',
        '组件',
        '空环境和迁移',
        '无预置数据启动 Compose，重复执行 migration',
        'health/readiness/version 全部通过；最终 schema hash 相同',
        'health.json + migration report',
      ],
      [
        'P0-I02',
        '组件',
        '迁移重复执行',
        '空库、半迁移库、重复执行',
        '最终 schema hash 相同；重复执行无副作用',
        'migration replay report',
      ],
      [
        'P0-R01',
        '可复现',
        '锁文件和产物',
        '两次 clean install',
        '依赖锁、生成文件和 artifact digest 相同',
        'reproducibility report',
      ],
    ],
  },
  {
    id: 'P1',
    name: 'Plane 连接器与工作图谱',
    tasks: 'T1.1–T1.5',
    requirements: 'R-002、R-005、R-008',
    scope:
      'Plane 版本矩阵、REST Client、Webhook 验签、去重/重试/死信/回放、ID 映射和 observed projection',
    dependencies: 'P0 契约/SDK/Fixture；Plane 使用版本固定的 Mock Server 或专用测试实例',
    fixtures: 'Plane Project/WorkItem 两个版本、签名 Webhook、重复/乱序/延迟事件、权限不同的 token',
    outputs:
      'ProjectSnapshot、WorkItemSnapshot、Canonical Event、projection revision、replay report',
    threshold: '验签拒绝 100%；重复事件副作用为 0；事件到 projection p95 ≤3s；回放结果可重现',
    tasksFiles: [
      't1.1-plane-version-matrix.md',
      't1.2-plane-rest-client.md',
      't1.3-webhook-security.md',
      't1.4-webhook-dedup-replay.md',
      't1.5-plane-projection.md',
    ],
    cases: [
      [
        'P1-U01',
        '单元',
        '能力矩阵',
        '支持/不支持的 Plane 版本和 endpoint',
        '不支持版本在启动前失败并给出原因',
        'capability snapshot',
      ],
      [
        'P1-C01',
        '契约',
        'P0 Schema/Fixture 消费',
        'P0 发布的事件、错误和 Plane Fixture',
        '消费方校验通过；未知字段、版本和 scope 处理符合契约',
        'consumer contract report',
      ],
      [
        'P1-S01',
        '安全',
        'HMAC 验签和 scope',
        '正确/错误/过期签名，跨租户 token',
        '仅正确签名进入队列；拒绝无事件和 projection 副作用',
        'security report + state diff',
      ],
      [
        'P1-S02',
        '安全',
        'Webhook 时间窗和重放',
        '旧 timestamp、重放 nonce、错误 secret',
        '返回 UNAUTHENTICATED/duplicate；不进入业务队列',
        'replay report',
      ],
      [
        'P1-I01',
        '集成',
        'REST 重试',
        '429、5xx、超时、分页',
        '按 Retry-After/上限重试；超过上限返回 retryable error',
        'request trace',
      ],
      [
        'P1-I02',
        '集成',
        'Webhook 去重',
        '相同 event_id 投递三次',
        '只生成一个 Canonical Event 和一次 projection',
        'event ids + projection diff',
      ],
      [
        'P1-I03',
        '集成',
        '乱序与回放',
        '版本 3 先于版本 2，再回放版本 2',
        '不回退 projection；回放结果可解释',
        'revision timeline',
      ],
      [
        'P1-I04',
        '集成',
        '工作图谱映射',
        'Project/WorkItem 更新、删除和恢复',
        '映射稳定；source_refs 指向 Plane object/version',
        'mapping report',
      ],
      [
        'P1-R01',
        '恢复',
        'Plane 暂不可用',
        '连接器运行期间 Plane down',
        '不丢 durable event；恢复后按 cursor 补齐',
        'outbox/replay report',
      ],
    ],
  },
  {
    id: 'P2',
    name: '上下文、文件、记忆与 ContextPack',
    tasks: 'T2.1–T2.5',
    requirements: 'R-003、R-008、R-009、R-013',
    scope: 'Artifact metadata、ai-memory Adapter、L0–L4、ContextPack 编译、FTS 和 MCP Resource',
    dependencies:
      'P0 契约/Fixture；P1 projection 使用 fixture；ai-memory 使用固定版本、隔离 wiki 和 SQLite derived index',
    fixtures: '已确认决策、未确认候选、过期记忆、敏感附件、同名文件、来源版本和预算边界',
    outputs: 'ArtifactRef、MemoryRef、MemoryHit、SourceReference、ContextPack、page revision/hash',
    threshold:
      'ContextPack hash 稳定 100%；来源完整 ≥98%；过期混入 ≤2%；未确认误标 ≤1%；越权返回 0 内容',
    tasksFiles: [
      't2.1-artifact-metadata.md',
      't2.2-memory-adapter.md',
      't2.3-context-layers.md',
      't2.4-context-compiler.md',
      't2.5-fts-resources.md',
    ],
    cases: [
      [
        'P2-U01',
        '单元',
        'Artifact hash',
        '相同字节、不同文件名、不同版本',
        '字节 hash 稳定；版本和来源可区分',
        'hash snapshot',
      ],
      [
        'P2-U02',
        '单元',
        'L0–L4 排序和预算',
        '决策、风险、候选、历史及不足 budget',
        '排序/截断稳定；保留 source_refs；不得把 proposed 标为 verified',
        'ContextPack + budget snapshot',
      ],
      [
        'P2-C01',
        '契约',
        'ai-memory Adapter',
        'capture、recall、consolidate、handoff、claim、restore',
        '映射到统一 MemoryRef/错误封套；revision 可核对',
        'adapter contract report',
      ],
      [
        'P2-I01',
        '集成',
        'capture/recall 真源',
        '写入脱敏内容后查询',
        '只返回授权 scope；Markdown 是真源；SQLite 是派生索引',
        'memory revision + db hash',
      ],
      [
        'P2-I02',
        '集成',
        'ContextPack/MCP Resource',
        '相同输入和 resource URI 分页、无权限请求',
        'pack hash 相同；来源可追溯；拒绝无正文泄露',
        'pack.json + MCP transcript',
      ],
      [
        'P2-I03',
        '集成',
        'MCP Resource 边界',
        '分页、未知 URI、过期 revision、跨 scope 请求',
        'resource 与 REST 语义一致；拒绝不泄露正文；错误可诊断',
        'MCP boundary report',
      ],
      [
        'P2-R01',
        '恢复',
        'ai-memory 不可用',
        'capture/recall 超时或服务停止',
        '返回 retryable；不伪造 verified 内容；恢复后可补偿',
        'failure trace',
      ],
    ],
  },
  {
    id: 'P3',
    name: '会话、检查点、交接与离线同步',
    tasks: 'T3.1–T3.5',
    requirements: 'R-004、R-005、R-006、R-013',
    scope:
      'Session、AgentRun、ToolCall、Checkpoint、Handoff/Resume、SyncCursor、SQLite Outbox、Conflict',
    dependencies: 'P0 事件/错误；P2 ContextPack/MemoryRef；网络、Plane、ai-memory 均可用替身模拟',
    fixtures:
      '两个 client session、可 claim 和已 claim handoff、断网 outbox、缺口 cursor、并发版本冲突',
    outputs:
      'SessionRef、CheckpointRef、HandoffRef、SyncCursor、ConflictDetected/Resolved、outbox state',
    threshold: 'claim-once 100%；durable outbox 无丢失；重复/乱序不产生重复副作用；冲突不静默覆盖',
    tasksFiles: [
      't3.1-session-model.md',
      't3.2-checkpoint-handoff.md',
      't3.3-sync-cursor-batch.md',
      't3.4-sqlite-outbox.md',
      't3.5-conflict-service.md',
    ],
    cases: [
      [
        'P3-U01',
        '单元',
        'Session 状态机',
        'created/running/paused/ended/failed 非法跳转',
        '非法跳转拒绝；合法跳转只产生一次事件',
        'state transition log',
      ],
      [
        'P3-U02',
        '单元',
        'Checkpoint hash',
        '相同 session event 序列',
        'checkpoint revision/hash 可重复；source_refs 完整',
        'checkpoint snapshot',
      ],
      [
        'P3-I01',
        '集成',
        'Handoff claim-once',
        '两个 client 同时 claim 同一 HandoffRef',
        '只一个成功；另一个返回 already_claimed',
        'claim audit',
      ],
      [
        'P3-I02',
        '集成',
        'Resume',
        'handoff + ContextPack + capability matrix',
        '生成权限过滤后的 Resume Pack；不复制未授权正文',
        'resume report',
      ],
      [
        'P3-I03',
        '集成',
        'SyncCursor/Outbox',
        'cursor 1、3 到达，缺 cursor 2；进程 kill',
        '检测 gap 并 replay；重启可读未发送项；drain 幂等',
        'cursor timeline + SQLite',
      ],
      [
        'P3-I04',
        '集成',
        'Conflict',
        '服务器 version 变更后提交旧版本',
        '返回 409/ConflictDetected；protected field 不被覆盖',
        'conflict record',
      ],
      [
        'P3-I05',
        '集成',
        '公开状态命令契约',
        'Session、Handoff、Conflict 的 API/事件/错误封套',
        'claim、resume、resolve 的版本、审计和错误语义稳定',
        'state command contract report',
      ],
      [
        'P3-R01',
        '恢复',
        'Outbox/游标恢复',
        '断电、数据库重启、缺口和重复 ack',
        '恢复后无丢失、无重复 effect，cursor 可继续推进',
        'recovery replay report',
      ],
    ],
  },
  {
    id: 'P4',
    name: '统一 MCP、REST、CLI 与客户端连接器',
    tasks: 'T4.1–T4.4',
    requirements: 'R-001、R-004、R-007、R-011',
    scope:
      'REST Gateway、MCP Resources/Tools/Prompts、workctx CLI、Codex/Claude Code/DeepSeek/WorkBuddy adapters',
    dependencies: 'P0 契约；P2 ContextPack；P3 Session/Handoff；P6 Policy/Audit/Trace SDK',
    fixtures: '同一请求的 REST、MCP、CLI transcript；能力矩阵；允许/拒绝 scope；伪客户端',
    outputs: 'WCP v1 response、MCP transcript、CLI exit code、adapter capability report',
    threshold:
      'REST/MCP/CLI 语义等价 100%；越权副作用为 0；trace/audit 覆盖率 100%；旧客户端兼容性通过',
    tasksFiles: [
      't4.1-api-gateway.md',
      't4.2-mcp-gateway.md',
      't4.3-workctx-cli.md',
      't4.4-client-adapters.md',
    ],
    cases: [
      [
        'P4-C01',
        '契约',
        'REST/MCP/CLI parity',
        '同一 get context、handoff、resume 请求',
        '字段、错误码、source_refs 和 revision 一致',
        'parity diff',
      ],
      [
        'P4-C02',
        '契约',
        'MCP conformance',
        'resources/tools/prompts、分页、错误',
        '符合 MCP 契约；未知能力可协商',
        'MCP conformance report',
      ],
      [
        'P4-S01',
        '安全',
        'Policy gate',
        '允许、拒绝、过期 token、scope escalation',
        '拒绝不调用下游写入，不产生事件副作用',
        'policy trace',
      ],
      [
        'P4-I01',
        '集成',
        '客户端切换',
        'Codex 创建、Claude claim、WorkBuddy 查询',
        'client_id 和 capability 不丢失；Resume 可继续',
        'client transcript',
      ],
      [
        'P4-I02',
        '集成',
        '错误映射和重启',
        'timeout、409、429、Gateway restart、重复 key',
        '各入口映射一致；服务端只产生一个 effect',
        'error parity + gateway trace',
      ],
      [
        'P4-R01',
        '恢复',
        '客户端能力矩阵恢复',
        'Gateway 重启、旧客户端、未知 capability',
        '版本协商稳定；降级不丢 scope、trace、审计和 resume 状态',
        'capability recovery report',
      ],
    ],
  },
  {
    id: 'P5',
    name: 'Web 工作台',
    tasks: 'T5.1–T5.3',
    requirements: 'R-001、R-006、R-007、R-011',
    scope: '项目/工作项查询、上下文、交接、冲突、审计、管理和发布健康界面',
    dependencies:
      'P1/P2/P3/P4 查询与写入接口；P6 Policy/Audit/Trace；浏览器使用固定 seed 和 API stub',
    fixtures: '两租户、多项目、两个 session、冲突、无权限和服务不可用 UI 状态',
    outputs: 'Playwright report、可访问性报告、Smoke artifact、用户可见错误状态',
    threshold: '关键旅程 100%；越权页面不显示正文；键盘可达；主要错误态有恢复动作；Smoke ≤5min',
    tasksFiles: [
      't5.1-workbench-query.md',
      't5.2-workbench-handoff-conflict.md',
      't5.3-workbench-admin.md',
    ],
    cases: [
      [
        'P5-U01',
        '组件',
        '查询状态',
        'loading/empty/error/stale/success',
        '每种状态有稳定文案、trace_id 或重试入口',
        'component snapshots',
      ],
      [
        'P5-I01',
        'E2E',
        '项目/工作项旅程',
        '打开项目、筛选 WorkItem、查看来源',
        '只展示授权数据；source link 可定位',
        'Playwright trace',
      ],
      [
        'P5-I02',
        'E2E',
        'Handoff/Resume',
        '查看候选、claim、resume',
        'claim 冲突可解释；成功后 session 状态更新',
        'video + trace',
      ],
      [
        'P5-I03',
        'E2E',
        'Conflict center',
        '旧版本提交和解决',
        '展示双方版本、protected fields、审计；刷新一致',
        'conflict evidence',
      ],
      [
        'P5-S01',
        '安全/可访问性',
        '租户隔离和键盘',
        '跨租户 URL、tab 顺序、表单错误',
        '无数据泄露；无阻断级可访问性问题',
        'security + axe report',
      ],
      [
        'P5-A01',
        '可访问性/构建',
        '前端 artifact 和 Smoke',
        '固定依赖、生产构建、键盘/屏幕阅读器路径',
        '构建可重现；Smoke 可定位版本；无阻断级可访问性问题',
        'build + accessibility report',
      ],
      [
        'P5-R01',
        '恢复',
        'Gateway/Policy down',
        '加载、提交、刷新期间下游不可用',
        '保留未提交输入；不显示旧授权数据',
        'failure screenshot',
      ],
    ],
  },
  {
    id: 'P6',
    name: '安全、治理与观测',
    tasks: 'T6.1–T6.3',
    requirements: 'R-007、R-009、R-011',
    scope: '身份、RBAC/OPA Policy、数据分类、审批、审计、OTel、metrics、logs 和告警',
    dependencies: 'P0 契约；Keycloak/OPA/OTel 使用隔离 Compose；其他模块使用 SDK stub 验证接入',
    fixtures: '两租户三角色、过期 token、敏感分类、审批记录、审计查询和 trace parent',
    outputs: 'PolicyDecision、AuditRecord、TraceContext、redaction report、alert evidence',
    threshold:
      '越权副作用 0；审计完整性 100%；敏感字段脱敏 100%；trace 贯穿率 100%；关键告警可触发',
    tasksFiles: ['t6.1-identity-policy.md', 't6.2-audit-governance.md', 't6.3-observability.md'],
    cases: [
      [
        'P6-S01',
        '安全',
        '租户隔离',
        'tenant A token 访问 tenant B',
        'deny；下游未调用；无正文泄露',
        'policy + side-effect diff',
      ],
      [
        'P6-S02',
        '安全',
        'scope escalation/审批',
        '低权限请求高风险 Tool；proposed promotion 无 approval',
        'deny reason 稳定；有审批且未过期才允许',
        'decision + approval audit',
      ],
      [
        'P6-S03',
        '安全',
        '注入/恶意文档',
        '工具参数、WorkItem、memory 含指令注入',
        '不执行命令；不改变 policy decision',
        'red-team report',
      ],
      [
        'P6-S04',
        '安全',
        '分类和 promotion gate',
        '敏感数据导出、proposal promotion、过期审批',
        '分类、审批和脱敏全部满足才允许；否则 fail-closed',
        'governance gate report',
      ],
      [
        'P6-I01',
        '集成',
        '审计完整性',
        '允许、拒绝、导出、恢复、删除',
        '含 actor/client/session/scope/trace/result',
        'audit completeness',
      ],
      [
        'P6-I02',
        '集成',
        'Trace propagation',
        'Gateway→service→event→worker',
        'trace_id/span_id 可关联；无孤儿关键操作',
        'trace graph',
      ],
      [
        'P6-R01',
        '恢复',
        'Policy/OTel down',
        '策略服务或 collector 不可用',
        '安全操作 fail-closed；降级有告警',
        'degradation report',
      ],
    ],
  },
  {
    id: 'P7',
    name: '搜索和智能能力',
    tasks: 'T7.1–T7.3',
    requirements: 'R-003、R-009、R-012',
    scope: 'Golden Context、抽取/建议 Worker、FTS/实体/链接/可选向量检索',
    dependencies: 'P1/P2/P3/P6 的只读/受控接口；模型和向量服务必须可替换并固定版本',
    fixtures: 'Golden Dataset、多阶段项目、过期事实、相似文件、未确认推断、提示注入样本',
    outputs: 'EvaluationReport、Proposal、SearchHit、source_refs、Feature Flag 状态',
    threshold:
      '来源完整 ≥98%；关键下一步 ≥95%；过期混入 ≤2%；未确认误标 ≤1%；提示注入不得改变 verified 状态',
    tasksFiles: [
      't7.1-golden-evaluation.md',
      't7.2-intelligence-workers.md',
      't7.3-search-vector.md',
    ],
    cases: [
      [
        'P7-E01',
        '评测',
        'Golden Context',
        '固定 dataset 和 prompt 版本',
        '可复现；报告记录模型、数据、阈值',
        'evaluation report',
      ],
      [
        'P7-E02',
        '评测',
        '来源和下一步',
        '答案/建议引用 source_refs；已知下一动作',
        '来源完整率 ≥98%；下一步命中率 ≥95%',
        'fidelity + next-action report',
      ],
      [
        'P7-E03',
        '评测',
        '过期与冲突',
        '旧 revision、冲突计划、已废弃决策',
        '过期混入 ≤2%；显式标记；不自动升级 verified',
        'stale report',
      ],
      [
        'P7-E04',
        '评测',
        '模型/索引版本锁定',
        '模型、prompt、FTS/embedding index、Golden dataset 版本变化',
        'EvaluationReport 可重放；版本漂移阻断发布',
        'evaluation version report',
      ],
      [
        'P7-S01',
        '安全',
        '提示注入',
        'memory、WorkItem、附件含恶意指令',
        '不执行工具；proposal 保持 proposed',
        'red-team transcript',
      ],
      [
        'P7-I01',
        '集成',
        'Search fallback',
        'FTS 命中、无命中、向量关闭',
        'FTS 默认；向量可选；结果有 revision/source_refs',
        'search trace',
      ],
      [
        'P7-I02',
        '集成',
        'Proposal 状态和来源',
        'proposal、verified、rejected、过期 source_refs',
        '状态不可静默提升；来源和审批可追踪',
        'proposal integrity report',
      ],
      [
        'P7-R01',
        '恢复',
        '模型服务不可用',
        '抽取/建议超时或限流',
        'retryable 或降级结果；不伪造答案',
        'worker failure report',
      ],
    ],
  },
  {
    id: 'P8',
    name: '统一发布、质量与私有化交付',
    tasks: 'T8.1–T8.3',
    requirements: 'R-005、R-008、R-010、R-011、R-013',
    scope: '集成/E2E/故障/性能编排、Compose/Helm、Release Manifest、SBOM、备份恢复和回滚',
    dependencies: '所有 P0–P7 版本化 artifact、Schema、migration、Fixture、Feature Flag 和 runbook',
    fixtures: 'clean install、upgrade、故障注入、备份包、旧版本 manifest、生产 smoke tenant',
    outputs: 'ReleaseManifest、SBOM、安装报告、恢复报告、回滚报告、上线 smoke',
    threshold:
      'clean install 100%；关键 E2E 全绿；备份恢复可用；回滚不丢事件/记忆/审计；manifest 可重放',
    tasksFiles: [
      't8.1-integration-e2e-resilience.md',
      't8.2-compose-helm.md',
      't8.3-release-rollback.md',
    ],
    cases: [
      [
        'P8-C01',
        '集成',
        'clean Compose',
        '空目录、固定 manifest',
        '所有依赖启动、migration、health/readiness 通过',
        'install report',
      ],
      [
        'P8-C02',
        '集成',
        'Schema/migration gate',
        '当前和上一版本 manifest',
        'expand/migrate/contract 正确；破坏性 diff 阻断',
        'migration gate report',
      ],
      [
        'P8-E01',
        'E2E',
        'Plane→MCP',
        'Webhook、projection、memory、ContextPack、MCP',
        '事件/trace/source_refs/revision 全部可关联',
        'JUnit + trace bundle',
      ],
      [
        'P8-E02',
        'E2E',
        '跨客户端',
        'Codex→handoff→Claude→Plane',
        'claim-once、resume、权限和审计全部通过',
        'client chain report',
      ],
      [
        'P8-R01',
        '恢复',
        '备份恢复',
        'Postgres、SQLite、ai-memory Markdown、manifest',
        '恢复后 hash、revision、event ids 可核对',
        'restore report',
      ],
      [
        'P8-R02',
        '恢复/性能',
        '升级回滚和关键 SLO',
        '迁移中断、应用回退、Resume/projection/ack 并发',
        '无丢失；p95 ≤5s/3s/1s；失败有界重试',
        'rollback + performance report',
      ],
    ],
  },
];

function taskLinks(files) {
  return files
    .map((file) => `- [${file.replace('.md', '')}](../../02-subprojects/tasks/${file})`)
    .join('\n');
}

function matrixRows(cases) {
  return cases.map((row) => `| ${row.join(' | ')} |`).join('\n');
}

for (const module of modules) {
  const doc = `# ${module.id} ${module.name} 独立测试与校验规范

> 本文件是 **${module.id}** 的独立测试门禁。实现人员只需要依赖本文列出的 Fixture、公开契约和替身，不得等待其他未完成模块的内部实现。

## 1. 测试范围和责任

- 子方案：\`${module.id} ${module.name}\`。
- 覆盖任务：${module.tasks}。
- 需求追踪：${module.requirements}。
- 模块边界：${module.scope}。
- 产物责任：${module.outputs}。

任务设计入口：

${taskLinks(module.tasksFiles)}

## 2. 独立运行边界

### 2.1 允许依赖

${module.dependencies}。外部依赖必须通过版本固定的 HTTP/MCP Mock、事件 Fixture、Testcontainers/Compose 服务或内存替身提供；测试不得直接读取其他模块的数据库、工作目录或内部类。

### 2.2 禁止依赖

- 不依赖 \`develop\` 上尚未发布的包、浮动镜像或未冻结的远端数据；
- 不依赖其他模块的私有表、私有文件、私有事件处理器或测试顺序；
- 不把失败重试当作成功证据，必须保存第一次失败的请求、trace 和状态差异；
- 不用真实敏感数据，Fixture 中的 token、secret、附件和 memory 内容必须是合成值。

### 2.3 标准命令

\`T0.1\` 必须提供以下命令入口。命令必须在干净工作区、固定 Node/pnpm 版本和锁文件下运行，并返回非零退出码来阻断失败。

\`\`\`powershell
pnpm run test:module -- ${module.id} --isolated
pnpm run test:contract -- ${module.id}
pnpm run test:module -- ${module.id} --isolated --reporter=junit
\`\`\`

## 3. 固定 Fixture 和环境

${module.fixtures}。每次运行生成唯一 \`run_id\`，但业务实体 ID 使用固定前缀 \`${module.id.toLowerCase()}-fixture-*\`，以便比较不同运行的事件、revision、hash 和审计结果。

环境必须输出：

- \`environment.json\`：镜像、包、Schema、migration、ai-memory/Plane 版本；
- \`seed.json\`：Fixture 版本、scope、初始 revision 和权限；
- \`health.json\`：health/readiness/version 结果；
- \`trace.jsonl\`：所有关键请求、事件、策略决策的 trace/span 关联。

## 4. 独立测试矩阵

| 测试 ID | 层级 | 校验目标 | 输入/故障 | 必须断言 | 证据 |
|---|---|---|---|---|---|
${matrixRows(module.cases)}

## 5. 通用断言和不变量

每个测试都必须根据适用范围执行以下断言：

${commonInvariants.map((item) => `- ${item}`).join('\n')}

## 6. 通过阈值和失败处理

${module.threshold}。任何一个安全、权限、数据完整性或契约兼容测试失败，整个模块不得进入集成。非关键性能波动可以重跑一次，但必须保留第一次结果，并由测试负责人在报告中说明原因；功能失败不得通过重跑掩盖。

失败报告至少包含：失败测试 ID、提交 SHA、manifest、Fixture 版本、请求/响应摘要、trace_id、数据库或事件差异、是否产生副作用、修复链接和复测结果。

## 7. 进入模块集成的门禁

- [ ] 本文矩阵中的所有必选测试通过；
- [ ] 测试证据已保存到 \`artifacts/test-reports/${module.id}/<run_id>/\`；
- [ ] 公开 Schema/API/Event diff 与本模块输出一致；
- [ ] health/readiness/version、migration、配置和回滚说明齐全；
- [ ] 需求追踪矩阵中的测试 ID 已更新；
- [ ] 下游协接方使用本模块发布的版本和 Fixture 完成契约测试；
- [ ] 模块负责人签署独立验证报告，才允许合并到 \`develop\`。

## 8. 独立报告模板

\`\`\`yaml
module: ${module.id}
run_id: <uuid>
commit: <sha>
manifest: <digest>
fixture_version: <semver>
status: passed|failed|blocked
required_tests: []
failed_tests: []
side_effect_check: passed|failed
contract_diff: none|approved|breaking
artifacts:
  junit: <path>
  trace: <path>
  health: <path>
  evidence: <path>
owner: <team>
verified_at: <timestamp>
\`\`\`
`;
  fs.writeFileSync(path.join(outputDir, `${module.id}-independent-verification.md`), doc, 'utf8');
}

const readme = `# 模块独立测试目录

本目录为 P0–P8 提供可独立运行、可独立验收的测试与校验规范。每个模块必须先在自己的 Fixture、Mock/Compose 替身和固定版本依赖中通过本文档，才能进入 \`docs/design/03-integration/\` 定义的集成阶段。

## 文档索引

${modules.map((module) => `- [${module.id} ${module.name}](${module.id}-independent-verification.md)`).join('\n')}

## 执行顺序

P0 的契约/Fixture 门禁先行；P1、P2、P6 可以使用固定替身并行验证；P3 在 P2 的 ContextPack 契约可用后验证；P4、P5、P7 依赖相应公开接口；P8 汇总全部模块报告执行统一集成、恢复、回滚和上线 Smoke。

所有模块的命令、证据目录、失败处理和报告字段必须保持一致；模块特有断言只写在对应模块文档中。
`;
fs.writeFileSync(path.join(outputDir, 'README.md'), readme, 'utf8');
console.log(`Generated ${modules.length} module verification docs.`);
