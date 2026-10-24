# 外部组件适配目录

本目录记录外部组件的固定版本、能力边界、适配方式、升级策略和恢复限制。外部组件不能成为未版本化的隐式依赖；每次升级必须更新 Release Manifest、兼容性测试和回滚说明。

## 文档索引

- [ai-memory 适配设计](ai-memory-adoption.md)：Markdown 真源、SQLite 派生索引、capture/recall、claim-once handoff、版本冻结和 fail-closed 策略。

## 维护规则

- 以 [ai-memory repository](https://github.com/akitaonrails/ai-memory) 为上游参考，实施前固定提交哈希和兼容性结论。
- 平台只通过版本化 Adapter 使用外部组件，不把外部数据库、私有文件或未发布 API 暴露为模块协接面。
- 外部依赖不可用时必须返回可诊断的 retryable/degraded 或 blocked 状态，并保存 trace/source_refs。
