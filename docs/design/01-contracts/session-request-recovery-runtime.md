# 会话与活动原请求的独立恢复（源码阶段）

更新：2026-11-03。只修改源码和文档，未编译、类型检查、测试、启动浏览器/服务、调用业务 API、执行迁移或发布。无新增依赖/API/迁移；016–048 保持未执行。

## 入口与范围

`/sessions/recover` 提供 session.start、checkpoint.save、end、run.start、run.finish、tool.call、tool.finish 七种原请求恢复入口。不接收 URL 参数，通过已有 `getWorkbenchSessionCommandContext()` 读取可信身份、到期与权限提示；不读取会话、运行、工具、检查点详情或目录，不凭任意客户端字段建立当前身份。身份读取失败时显示错误与重新加载链接，原浏览器存储不被清除。身份接口仍依赖正常鉴权、策略及入口审计，见 [独立会话身份](session-command-context-runtime.md)。

会话列表成功/失败与独立会话详情共用的 SessionLookup 提供同标签页恢复链接。运行/工具详情、活动创建页的成功与错误视图也提供该链接，交接恢复页与会话恢复页互相导航。使用同标签页是为了保留原 sessionStorage；进入其他标签页时需自行导出并在原身份下导入。导航不携带恢复正文、笔记、原版本或请求键。

## 加载原请求

用户先选择原操作，然后明确加载精确保存槽，或粘贴既有恢复文本。本地加载只定位当前可信身份对应的一个槽，不扫描全部存储、猜测原版本或读取服务端当前记录。槽不存在不证明原请求未发送或失败；错误、损坏、身份/目标不符均保留输入与已存数据。

| 操作 | 本地槽定位输入 | 不可补造的字段 |
| --- | --- | --- |
| session.start | 当前可信原身份，无需会话 ID | 新会话 ID、父会话、可选账号/客户端及原请求键 |
| checkpoint.save / end | 原会话 ID | 原笔记/包或结束结果、版本和键 |
| run.start | 原会话 ID | 新运行 ID、原可选模型、版本和键 |
| tool.call | 原会话 ID、原所属运行 ID | 新工具调用 ID、原工具名/初始状态、版本和键 |
| run.finish / tool.finish | 原会话 ID、原运行/工具调用 ID | 原结果、会话及资源版本和键 |

原 start、checkpoint、finish 和 activity-create 模型分别导出共用存储键函数，正常页面与独立恢复页调用同一函数，原键字符串保持不变：

- 检查点：`planemem-checkpoint-save-v1:` + JSON.stringify([identity, sessionId])。
- 收尾：`planemem-session-finish-v1:` + JSON.stringify([identity, operation, sessionId, resourceId])；end 的槽 resourceId 仍使用 sessionId，但其业务请求中仍无 resourceId/resourceVersion。
- 开始会话：`planemem-session-start-v1:` + JSON.stringify(identity)，与父会话选择或新建结果 ID 无关。
- 活动创建：`planemem-activity-create-v1:` + JSON.stringify([identity, sessionId, operation, runId])；run.start 原 runId 为 undefined，数组 JSON 内仍为 null，不能改成会话 ID、空串或新建运行 ID。tool.call 使用原所属运行 ID。

导入只接受各操作的现有版本 1 格式。检查点最多 262144 个 UTF-16 单元，其余六种最多 32768；不接受当前页面状态、已保存成功标记或确认字段作为恢复证据。解析后的 tenant/workspace/project/actor/client 必须完全匹配当前可信身份，finish/activity operation 必须匹配所选操作。按槽加载还要核对正文里的原会话与适用资源 ID。SDK/CLI 的不同命令文件不自动转成工作台恢复格式。

检查点六类笔记继续逐项保留原字符串、空白、顺序、重复项及条目内换行，不做 trim/split。仍要求每类最多 200 项、按换行拼接最多 16384 个 UTF-16 单元，完整 notes 至少一项；保持原 contextPackId、版本和键。收尾保持原 outcome、会话版本以及适用的资源 ID/版本。加载视图展示这些原值，检查点按原数组条目展示，不将笔记内容当作 HTML 执行。

## 本地保存与操作

加载后只挂载固定原请求组件，不生成 SessionClosureState 或任何虚构当前状态。初始结果未知、确认未勾选，当前记录未读取的提示明确可见。没有新草稿、换键、采用当前版本、改变结果或替换原请求的控件。加载和初次导入不会改写存储；导入内容先保留于当前页面内存，刷新/离开前应保存或保留导出文本。

Save original request in this tab 只保存这个原请求，并读回检查；Export original request 只在只读文本框输出已有格式。二者不调用业务 API、不保存成功或确认状态。保存前校验槽内容，只有不存在或完整相同原请求时才写入；不同版本/键/笔记/结果、损坏文本或存储不可用会阻止重试写入，不覆盖另一份原请求。即使存储失败，仍保留内存原请求供导出和明确查回执。

查询与重试复用 submitStart/submitActivityCreate/submitCheckpointSave/submitActivityFinish 及各自完整反馈解析器，不新增 Server Action 或后端事务。组件同步互斥，进行中的请求阻止重复点击以及本地保存/导出。重试需可写提示与重新勾选确认，发送前再次保存并读回原请求；存储失败不发送写入。每次操作以及权限提示变化都撤销确认。原身份/正文/适用版本/键固定，后端仍重新检查当前授权和并发条件。

开始会话完整保留原 session 对象中的可选 parent_session_id/actor_id/client_id，省略的字段显示为未提供，不在重试中补入；这个请求本来没有 expected_version，也不制造版本。运行创建保留 model 是否省略及原字符；工具记录保留 runId、toolName 和初始 status。名字的原空白不被 trim，未提供模型不自动补成当前默认值。原解析器继续限制名称 1024 字符及合法状态，不扩大恢复格式。

回执查询无需勾选确认。即使元数据未给出写权限或存储失败，界面允许明确请求查询，后端仍可以按原权限拒绝；这不构成权限豁免。查询会尝试保留本地原请求，但保存失败只影响本地恢复，仍可用内存原请求作只读查询。

所有恢复动作传入此前结果未知，任何后续未查到、身份错误、拒绝、版本冲突、无效响应或响应丢失都不能清除未知。只有完整解析并匹配原请求的 recorded 回执/正常成功响应才显示确认；客户端拒绝将既有未知反馈降级成确定失败。成功后保留原请求及导出/本地保存，关闭本页重试按钮，不自动进行后续命令或清理恢复槽。

## 历史结果与当前状态

检查点成功显示原 revision 和保存的 checkpoint_id，可在新标签页读取该检查点；其回执不确认当前上下文包有效。运行/工具成功可打开对应当前记录，会话关闭成功仍只说明原关闭请求历史。会话状态导航使用原 session_id，所有链接禁用预取并需独立访问检查。记录收尾不会停止连接、代理运行或外部工具进程。

session.start 的新 session_id 只能来自匹配的原开始回执；确认前没有新会话详情链接，不把可选父会话 ID 当作新会话。run.start/tool.call 的新 run_id/tool_call_id 也来自匹配的原历史回执，并链接独立当前详情。这些记录请求不调用模型、执行工具或证明外部执行已经发生；成功后不自动新建下一条记录。

## 尚未完成

七种会话/活动操作的独立恢复已接入源码，其他工作台业务操作不在本恢复页范围。正常页面原有编辑/刷新行为没有在本增量重写。原格式、服务端授权/持久回执/事务和 API 正文均保留；没有新增统一响应期限或全进程内存保证。

本地存储冲突/配额、禁用存储、身份或权限改变、原记录不可读、笔记保真、开始原可选字段、创建原模型/名称/状态、点击互斥、未知结果和各详情导航均尚无运行证据；R-004 保持未完成。
