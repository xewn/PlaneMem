# MCP 接口契约 v1

## Resources

```text
work://project/{project_id}
work://project/{project_id}/current-state
work://project/{project_id}/plan
work://work-item/{work_item_id}
work://work-item/{work_item_id}/context
work://work-item/{work_item_id}/timeline
work://work-item/{work_item_id}/decisions
work://work-item/{work_item_id}/risks
work://work-item/{work_item_id}/artifacts
work://session/{session_id}/checkpoint
work://session/{session_id}/handoff
memory://project/{project_id}/page/{page_id}
```

## Tools

`get_project_context`、`get_work_item_context`、`create_work_item`、`update_work_item`、`record_checkpoint`、`create_handoff`、`accept_handoff`、`record_decision`、`record_risk`、`attach_artifact`、`search_project_context`、`memory_read_page`、`memory_query`、`resolve_conflict`、`request_approval`。

## Prompts

`resume_work`、`prepare_handoff`、`review_current_plan`、`analyze_blockers`、`summarize_recent_progress`、`prepare_status_report`。

## 安全规则

MCP server 不直接连接 Plane/数据库；每个 Resource/Tool 先做 scope check 和 capability check，再生成审计；ai-memory MCP 只能通过受控 Adapter 暴露，不能把内部管理工具直接暴露给普通客户端。

## 能力协商

客户端声明 MCP protocol version、resources/tools/prompts、上下文预算、是否支持 streaming、是否支持 local files 和 handoff claim。服务按声明降级为 REST/CLI/Markdown。
