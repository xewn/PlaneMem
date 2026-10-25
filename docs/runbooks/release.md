# 发布、备份恢复与回滚 Runbook

1. 由 CI 生成 `deploy/release-manifest.yaml`，替换所有 `SET_BY_CI` digest 并保存 SBOM、迁移 checksum、测试证据和批准记录。
2. 执行 preflight：契约、P6 安全、P7 评测、迁移兼容性、备份恢复和健康检查全部通过后才允许打开 Feature Flag。
3. 发布顺序为 expand migration → 部署应用 → readiness/smoke → replay outbox → 启用非默认能力。`proposal_enabled` 与 `vector_enabled` 默认关闭。
4. 回滚前冻结写入、选择上一份已批准 manifest、恢复 Postgres/SQLite/ai-memory 备份，校验 hash、revision、event_id 和 audit_id，再重放 outbox 并运行 smoke。
5. 任意关键检查失败都停止发布并保留 trace、状态差异和第一次失败证据；不能在生产临时修改 schema 或接口。

Docker、Helm、PostgreSQL、ai-memory 和真实 OTel 的运行结果必须归档到 `artifacts/test-reports/P8/<run_id>/`，本地无对应工具时只能标记为 external gate。
