# 模块协接契约测试矩阵

## 1. 使用方式

每条 `IF-*` 协接边必须同时有提供方测试和消费方测试。提供方测试证明“输出符合契约”，消费方测试证明“实际调用方式和错误处理符合契约”。两者都通过，边才可以在集成环境启用。

测试命令由 P0/T0.1 统一提供：

```powershell
pnpm run test:module -- <P> --isolated
pnpm run test:contract -- <P>
pnpm run test:contract -- --edge IF-Px-Py
```

矩阵自身由 `tests/contract/edge-contract-matrix.test.mjs` 校验：每条 `IF-*` 必须同时声明提供方和消费方测试边界，并且两端的模块测试目录、独立测试文档和接口契约行都必须存在。该检查只证明协接定义完整；真实服务行为仍由对应模块和 Nightly/RC 门禁验证。

证据目录统一为：

```text
artifacts/contracts/<edge>/<run_id>/
  provider-report.json
  consumer-report.json
  schema-diff.json
  fixture.json
  trace.jsonl
  failure-cases.json
```

## 2. 边级测试矩阵

| 协接边 | 提供方独立测试 | 消费方独立测试 | 必须覆盖的失败 | 集成门禁 |
|---|---|---|---|---|
| IF-P0-P1 | P0-C01/P0-C02 | P1-U01/P1-C01 | Schema 不兼容、未知字段、重复 event | PR + Merge |
| IF-P0-P2 | P0-C01/P0-C03 | P2-C01/P2-U01 | 缺 scope、未知 classification、序列化差异 | PR + Merge |
| IF-P0-P3 | P0-C02/P0-U03 | P3-U01/P3-I03 | 重复、乱序、缺 cursor | Merge + Nightly |
| IF-P0-P4 | P0-C03 | P4-C01/P4-C02 | REST/MCP schema mismatch | PR + Merge |
| IF-P0-P6 | P0-C01 | P6-S01/P6-I02 | trace/context 缺失 | Merge |
| IF-P0-P8 | P0-I02/P0-R01 | P8-C01/P8-C02 | migration breaking、digest 漂移 | RC |
| IF-P1-P2 | P1-I04 | P2-I01/P2-I02 | revision 回退、source_refs 缺失 | Merge + Nightly |
| IF-P1-P5 | P1-I04 | P5-I01/P5-S01 | 越权对象、404/empty 不一致 | Nightly |
| IF-P1-P7 | P1-I04 | P7-E02/P7-E03 | stale 输入、无来源建议 | Nightly |
| IF-P1-P8 | P1-R01 | P8-C01/P8-E01 | Plane unavailable、回放缺口 | RC |
| IF-P2-P3 | P2-U02/P2-C01 | P3-I02 | 未授权正文、pack hash 漂移 | Merge + Nightly |
| IF-P2-P4 | P2-I02/P2-I03 | P4-C01/P4-C02 | 分页、MCP resource deny | Merge |
| IF-P2-P5 | P2-I02 | P5-I01/P5-U01 | stale/denied UI 泄露 | Nightly |
| IF-P2-P7 | P2-I01/P2-I02 | P7-E01/P7-E02/P7-I01 | FTS fallback、来源不完整 | Nightly |
| IF-P2-P8 | P2-R01 | P8-R01/P8-R02 | ai-memory backup/restore 不一致 | RC |
| IF-P3-P4 | P3-I01/P3-I04/P3-I05 | P4-I01/P4-I02 | already_claimed、409、重启重试 | Merge + Nightly |
| IF-P3-P5 | P3-I05 | P5-I02/P5-I03 | protected field 被覆盖 | Nightly |
| IF-P3-P7 | P3-I02 | P7-E03/P7-E04 | session 未确认被提升 | Nightly |
| IF-P3-P8 | P3-I03/P3-I04/P3-R01 | P8-E02/P8-R01 | outbox 丢失、cursor gap | RC |
| IF-P4-P5 | P4-C01/P4-I02 | P5-I01/P5-I02 | 入口语义不一致、错误态缺失 | Nightly |
| IF-P4-P8 | P4-I01/P4-R01 | P8-E02/P8-C01 | client capability 漂移 | RC |
| IF-P6-P4 | P6-S01/P6-S02/P6-I01 | P4-S01 | deny 后仍调用下游 | PR + Merge |
| IF-P6-P5 | P6-S01/P6-I01 | P5-S01/P5-R01 | 页面正文泄露、脱敏失败 | Nightly |
| IF-P6-P7 | P6-S03/P6-S04 | P7-S01/P7-I02 | prompt injection、无审批 promotion | Nightly |
| IF-P6-P8 | P6-I01/P6-I02/P6-R01 | P8-C02/P8-R02 | 无审批发布、关键告警缺失 | RC + Production |
| IF-P7-P5 | P7-E02/P7-E03 | P5-I01/P5-U01 | proposal 显示为 verified | Nightly |
| IF-P7-P8 | P7-E01/P7-E04 | P8-C01/P8-R02 | 模型/索引版本未锁定 | RC |
| IF-P5-P8 | P5-I01/P5-A01/P5-R01 | P8-C01/P8-E01 | 构建漂移、Smoke 失败 | RC + Production |

## 3. 契约测试的固定断言

每条边至少执行以下断言：

- 提供方输出可用 P0 发布的 Schema 校验；
- 消费方使用 immutable fixture，不通过内部数据库造数据；
- 合法请求的字段、枚举、revision、source_refs 和错误码与契约完全一致；
- 非法请求、过期版本、权限拒绝、重复请求、超时和上游不可用都返回规定的错误封套；
- 失败场景检查数据库、事件、outbox、审计和 ai-memory page 是否产生副作用；
- 两端的 trace_id、scope、schema_version 和 artifact digest 可在证据中关联。

## 4. 集成阶段门禁

### Gate A：契约冻结

- P0 Schema/SDK/Event 检查通过；
- 所有 `IF-*` 都有提供方和消费方测试；
- 破坏性 diff 有 ADR、迁移窗口和回滚；
- `requirements-matrix.yaml` 的测试 ID 和模块边界已更新。

### Gate B：模块合并

- 相关 P0–P8 独立测试通过；
- 相关边的 provider/consumer report 都存在；
- 版本、digest、Fixture、health/readiness/version 已进入临时 manifest；
- 不存在跨模块私有 import、数据库 join 或本地文件读取。

### Gate C：Nightly 集成

- 使用真实 Compose 依赖运行链路；
- 执行重复、乱序、断网、重启、冲突、越权、提示注入和超时场景；
- 保存 JUnit、trace、event IDs、ContextPack hash、memory revision、Plane IDs 和 audit IDs；
- 失败自动标记受影响边和下游模块，禁止只重跑下游而跳过上游契约。

### Gate D：RC/生产

- Release Manifest 锁定全部 artifact 和外部版本；
- 备份恢复、升级回滚、生产 Smoke 和 observability 通过；SBOM 仅作可选记录；
- P8 批准后才打开 Feature Flag；没有通过的 P7 建议能力保持关闭；
- 任何 Gate D 失败都回滚 manifest，而不是在生产临时修改接口。

## 5. 协接变更清单

提交涉及模块接口时必须回答：

- [ ] 是否修改 `IF-*` 的输入、输出、错误、权限、事件或版本？
- [ ] 是否新增/删除字段、枚举、事件或 MCP capability？
- [ ] 是否改变 source of truth、revision、hash、scope 或 classification？
- [ ] 是否新增 migration、outbox、回放、备份或回滚要求？
- [ ] provider 和 consumer 的独立测试是否都更新？
- [ ] 是否更新模块测试文档、本文矩阵、需求追踪和 Release Manifest？
- [ ] 是否附带失败路径证据，证明拒绝请求无副作用？
