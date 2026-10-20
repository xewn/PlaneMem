# 安全、隐私和数据治理设计

## 身份和授权

- Keycloak 提供 OIDC/SSO；
- WorkMesh Gateway 从 Token 解析 tenant/workspace/project scopes；
- P0 先 RBAC，企业阶段增加 OPA/Rego ABAC；
- ai-memory 的 MCP/HTTP token 只能由受控 Adapter 持有；
- 每次 recall/read/handoff claim 都执行 WorkMesh scope check。

## 工具能力

read、write、execute、export、external-network、model-call、approval-required 作为显式能力。客户端连接注册时声明能力，Policy 决定是否允许。

## 数据分类

`public`、`internal`、`confidential`、`restricted`。Context Compiler 必须根据用户、客户端、项目和工具能力过滤；restricted 数据默认不能进入外部模型调用。

## 审计

记录敏感读取、写入、导出、Plane Connector、ai-memory Adapter、MCP Tool、策略决策、审批、恢复、删除和回滚。每条记录带 actor、client、session、scope、trace_id、source_refs、result 和 error。

## 提示注入

Plane 页面、附件、ai-memory 页面、Hook observations 和搜索结果全部视为不可信数据。系统指令、当前用户指令和 checkout 状态优先；上下文注入采用明确的 untrusted-data fence。

## 删除与留存

WorkMesh Audit 只追加；ai-memory 记忆按其 git-backed page/版本链和受控 decay 管理。导出必须生成 ExportRecord；保留策略变更需要审批和审计。
