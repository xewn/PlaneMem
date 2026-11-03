# Plane Connector

The connector owns Plane version compatibility, typed REST transport, webhook verification, delivery deduplication, replay and observed projections.

The public boundary is `@planemem/plane-connector`. Consumers use the typed `PlaneClient`, `verifyWebhook`/`acceptWebhook`, `WebhookLedger`, and `PlaneProjection` APIs. They do not access Plane tables, raw URL builders, or internal connector state.

The pinned compatibility contract is maintained in [`integrations/plane/compatibility.yaml`](../../integrations/plane/compatibility.yaml). Update the matrix, fixtures and P1 tests together when a Plane version or capability changes.

## REST transport development (2026-11-02)

`FetchPlaneTransport` now implements a single HTTP attempt, and `createFetchPlaneClient(config, transportOptions?)` connects it to the typed client. No requests were sent during this development. Native Plane endpoint, authentication, pagination, ETag and idempotency compatibility remain unverified; existing route mappings have not changed. Gateway write routes and command reconciliation are still separate unfinished work.

```ts
import { createFetchPlaneClient } from '@planemem/plane-connector';

const client = createFetchPlaneClient({
  base_url: configuredPlaneOrigin,
  api_token: configuredToken,
  workspace_slug: configuredWorkspace,
  trace_id: requestTrace,
  max_retries: 2,
});
// A read-only example for later integration; not executed during development.
const result = await client.getProjectResult(projectId, { signal });
// result.data is validated; result.etag is the optional opaque upstream value.
```

Existing `getProject`, `createWorkItem`, `updateWorkItem`, and `listAttachments` methods still return their data objects. Their corresponding `*Result` methods additionally return `status`, `trace_id`, and a valid optional `etag`. New `getWorkItem` and `getWorkItemResult` methods read the single-record address already used for updates (`/api/projects/{projectId}/issues/{workItemId}`); native compatibility of this GET mapping remains unverified. Project reads and work-item reads/updates must match the requested resource ID. The attachment contract remains `{items, has_more, next_cursor?}` with at most 1000 items; a continuation must agree with `has_more` and must not repeat the input cursor. No native response-envelope conversion is implied.

`getProjectIfChanged(projectId, etag, options?)` and `getWorkItemIfChanged(projectId, workItemId, etag, options?)` send one explicit upstream ETag as `If-None-Match`. Both return `PlaneConditionalResult<T>`, discriminated by `not_modified`. A fresh response has validated `data` and an optional actual response `etag`; a 304 has no `data`. Both branches retain `requested_etag`. A 304 may omit its ETag; if supplied, it must be valid and match the requested opaque value, ignoring only the optional `W/` prefix. Duplicate, malformed or mismatched 304 ETags are rejected. Ordinary reads and writes reject 304. A 304 needs no JSON body or media type; custom transports must return `data: undefined` for it.

```ts
// Read-only integration example; not executed during development.
const first = await client.getWorkItemResult(projectId, workItemId, { signal });
if (first.etag) {
  const check = await client.getWorkItemIfChanged(projectId, workItemId, first.etag, { signal });
  if (!check.not_modified) {
    // check.data is newly validated upstream data.
  }
}
```

The client does not cache or merge responses. A caller retaining a body and ETag must bind them to the same origin, workspace, project, resource, credential identity and applicable permissions; changing these requires a fresh read. Never infer a missing ETag from `version`. Neither a current read nor a 304 proves that a particular earlier write committed. An unknown create without a resource ID cannot be resolved automatically by these methods. Reads do not generate observation events.

All methods accept a final optional `{ signal }`; attachments retain the cursor argument before it. Configuration is snapshotted per client. Use a new client when credentials or the request trace change. Base URLs must be HTTP(S) origins without a path, query, fragment or credentials. IDs are validated and encoded as single segments; slash, backslash, percent, query/fragment delimiters and dot paths are rejected. Update preconditions must be one quoted upstream ETag, not `*` or a fabricated WCP/observation version.

Transport defaults are 30 seconds for headers and the complete body, a 1 MiB request limit, and a 4 MiB decoded response-byte limit. Configurable limits are 1–120000 ms, up to 16 MiB request and 32 MiB response; typed-client writes retain a 1 MiB ceiling. JSON also has a 64-level/100000-node bound and rejects lossy values, sparse arrays, accessors and cycles. Successful responses must be UTF-8 JSON and pass the resource parser. Redirects are rejected; cookies are not sent. Error bodies, credentials, raw request URLs and upstream exception messages are not included in connector errors.

Only GET retries transient transfer failures and HTTP 408/429/5xx. `max_retries` defaults to 2 (0–5), `retry_delay_ms` to 250 (1–10000), and `max_retry_delay_ms` to 30000 (at least the base, at most 60000). Exponential jitter is combined with a usable Retry-After seconds/date value. A server wait exceeding the configured maximum stops automatic retries and exposes `retry_after_ms`; it is never shortened into an earlier retry. Cancellation interrupts active fetch/body reads and backoff. Timeouts apply per attempt; use a caller signal for an overall deadline.

POST/PATCH never retry automatically. Failure after dispatch, including an invalid 2xx response, reports `details.write_outcome='unknown'` and `retryable=false`; local validation/cancellation before dispatch reports `not_sent`. The false retryable flag does not prove that a write failed. Preserve the original request/key and reconcile with the upstream record before deciding on another write. A request key is forwarded but is not a verified upstream idempotency guarantee. Successful API responses do not update observed projections or generate observation events.

`PlaneTransportResponse<T>.data` may now be undefined on non-success responses, including conditional 304. Custom transports should return status/headers for HTTP failures, honor the optional signal and leave retry policy to `PlaneClient`. Legacy fixtures that return a work-item ID for a project or a different ID after an update no longer satisfy resource identity validation; fixture and runtime evidence remain pending. Conditional GET support also remains unverified against native Plane. This increment changed source and documentation only: no build, typecheck, tests, service startup, dependency installation, migrations or release.
