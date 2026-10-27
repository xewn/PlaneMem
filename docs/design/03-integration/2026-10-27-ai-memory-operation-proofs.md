# ai-memory original-operation receipts for P02

Status: public MCP candidate verified; PlaneMem integration awaits remote acceptance. Extends the
approved P02 continuity Task 3. The five PostgreSQL session actions are already
verified separately; this work supplies the three missing memory actions.

## Fixed contract

`ai-memory.operation.v1` identifies a durable operation by resolved workspace,
project and operation key. The immutable binding also contains the authenticated
actor storage key, caller client ID, action, P02 specification digest and canonical
request digest. A positive attempt number selects one dispatch. Transport trace,
current project pointers and current page state never replace these fields.

The MCP boundary recomputes the request digest from the original typed tool
arguments, with the operation stamp excluded. Object keys are recursively sorted;
arrays retain order. The store also computes an effect digest from its typed
command. Reusing a key with a changed binding or changed command fails.

The original receipt stores the result JSON, UUID and UTC microsecond timestamp.
It survives later handoff acceptance, page supersession and process restart.
Query returns that receipt. An absent record or unfinished reservation means
Unknown, never proof of no effect. Query does not create a record.

Explicit close can persist NoEffect only for an absent attempt after checking the
whole operation history. A completed attempt returns its existing receipt; a page
reservation cannot be closed. Attempt 1 is the first attempt. Attempt N requires
attempt N-1 to be durably closed NoEffect; success cannot be retried. Closed
attempts remain fenced permanently. All checks and writes use the SQLite writer
actor and an immediate transaction, including close-versus-execute races.

## Mutation boundaries

Handoff creation inserts the handoff and original receipt in one transaction.
Handoff acceptance uses the existing scope/ownership checks and both open-state
guards, then snapshots the accepted handoff and inserts its receipt in the same
transaction. A failed claim rolls back the transaction; it does not synthesize a
successful claim or NoEffect. Receipt insertion failure rolls back the effect.
Legacy handoff writers remain compatible because they use the same actor and
state guards. Only callers supplying the new operation stamp obtain recovery.

Page writing reserves an operation before entering the existing Wiki write
pipeline. One writer-issued claim authorizes one write. The page and its indexes
commit with the receipt in a single SQLite transaction. Sanitization, admission,
attribution, atomic file replacement and rollback stay in Wiki. A crash between
file replacement and database commit leaves Unknown and blocks redispatch; SQLite
cannot make a filesystem rename atomic with its transaction. This limitation must
be visible in documentation and recovery tests.

## Integration and acceptance still required

The public MCP surface extends the existing three tools with an optional
operation stamp and add original-operation query/close. Existing calls keep their
current response shape. ScopeResolver and existing tool authorization remain the
entry points. SDK schemas, wrappers, tool coverage and routing documentation must
ship with the public implementation. PlaneMem advertises each action only when
its preparation table and the actual MCP tool schemas are available.

Runtime tests run only on remote k3s. Required evidence includes effect/receipt
rollback, concurrent claim and close, original results after restart and later
state changes, actual MCP response loss, nonempty recall, and P02's eight-action
flow. Store-only tests do not certify MCP, PlaneMem or the whole P02 candidate.

## MCP implementation details

The optional `operation` stamp supplies protocol, operation key, specification
digest, attempt and the provisioned ai-memory workspace/project UUIDs. UUIDs must
be frozen before dispatch (available through the existing project API), not
replaced after a timeout. The authenticated actor and client come from request
context. Stamped execution requires an explicit existing scope whose IDs match
the stamp; it cannot create or silently switch projects. Query and close resolve
the fixed IDs through the existing scope resolver, so a rename does not replace
the historical binding.

`memory_operation_query` and `memory_operation_close` take the action plus the
original typed arguments, including the stamp. The server fills defaults and
hashes those typed arguments without the stamp. Clients need not reproduce Rust
serialization or infer a request digest from an unavailable response. Query
returns `{ protocol, outcome: "unknown", receipt: null }` or the original receipt;
close returns the stored terminal receipt. The three stamped mutation tools also
return the receipt; their unstamped response shapes stay unchanged.

Version 1 covers ordinary project page writes and exact handoff claims. Stamped
page writes reject session consolidation, profile/global scope and conditional
write flags before any reservation. Those existing tool modes remain available
without the stamp; they are not advertised as recoverable operations. Exact claim
recovery checks the receipt before looking at the handoff's current open state.
The same owner checks and admission pipeline still govern a first execution.

## PlaneMem preparation and translation

The gateway now routes `evidence.write`, `handoff.create` and `handoff.claim`
through `MemoryContinuityOperations`. Migration 012 adds `wcp_memory_operations`,
an immutable prepared-command table. Before a first external mutation it resolves
the existing workspace/project UUIDs through `/api/v1/projects`, constructs the
complete command, and commits it to PostgreSQL. Concurrent preparation reads back
the winning row. No PostgreSQL transaction spans an MCP request.

The row binds the original request, endpoint URL, configured reference and digest,
tenant/workspace/project, actor/client and trace. An existing key with different
input is refused. Query never prepares a row or resolves replacement UUIDs. It
uses the stored command and asks ai-memory for its original receipt. An absent
row or receipt stays Unknown. Explicit close delegates to ai-memory's permanent
NoEffect fence; only the stamp's attempt changes for a later authorized attempt.

Evidence pages use a deterministic operation path and carry the supplied summary,
evidence reference and source references. Handoff preparation reads the exact
page version, freezes its bounded summary before committing the command, and
keeps the original page reference. Recovery never re-reads a newer page body.
Claims carry the exact ai-memory handoff UUID. These IDs are distinct from WCP
session handoffs.

PlaneMem translates the original receipt into `p02-continuity-v1` using its saved
request and original actor/client, receipt UUID, result and microsecond timestamp.
It does not replace those values with current page/session state or the query
time. The timestamp keeps six fractional digits. Page revisions remain the
existing provider's deterministic page-ID revision; the actual SHA-256 comes from
the original page receipt. The PostgreSQL row contains no duplicate memory
aggregate or invented successful result.

Runtime assembly requires `MEMORY_PROVIDER_MODE=ai-memory-mcp`,
`AI_MEMORY_URL`, `AI_MEMORY_ACTOR_PROXY_TOKEN`, the existing continuity endpoint
reference/configuration digest, and migration 012. The ai-memory server must
enable its read API and use the matching configured actor-proxy credential.
PlaneMem sends the server's canonical `x-memory-actor-user` and
`x-memory-actor-client` fields; a legacy handoff claim also forwards the specified
accepting client without changing the default client's session. Capability
discovery checks the table and tool schemas on each request. Memory operations
consume `context.write`, while the five session operations retain `session.write`.

Current evidence: ai-memory candidate `e32ad1a` passed the full remote MCP suite
(730 passed, 0 failed, 1 opt-in live-provider test ignored), with actual tool-list
schema matching the SDK snapshot. The SDK has 101 passing unit tests and its
schema, generated docs, types and API documentation checks pass. PlaneMem's 32
selected tests use explicit in-memory stores or fake transport; they establish
translation and orchestration only. Remote job `p02-memory-flow-r4` on
192.168.1.232 passed all eight acceptance groups with actual PostgreSQL, P02 ABP
Hosts and the Rust ai-memory server. They cover the complete eight-action chain,
preparation rollback before MCP mutation, concurrent ABP claims, local receipt
rollback, actual MCP reply loss, and recovery of the original receipt after all
three services restart. The updated full module suite passed 145 tests, failed
none and skipped three explicitly gated live tests.

The runtime uses real FTS with embeddings explicitly disabled. Nonempty recall
preserves the original page reference and `degraded=true`. P02's Required binding
still returns 503; a separate Optional binding exposes the nonempty degraded
result. This does not establish production readiness for Required retrieval.
Identity and device review are fixture ports; same-Pod emptyDir demonstrates
process recovery only. There were no model calls.

The failed r1/r2 images packaged an old internal runtime dependency despite a
current gateway build. Staging now checks all 352 internal compiled files before
image creation. The r3 failure exposed the FTS degradation assumption; the r4
harness tests both Required rejection and Optional recall without weakening the
product contract. Failed runs are retained with their own source snapshots.
Task 3 is complete; Task 4 role consumers, final candidate review and publication
remain pending.
