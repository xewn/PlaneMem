# ai-memory original-operation receipts for P02

Status: candidate implementation, not an advertised MCP capability. Extends the
approved P02 continuity Task 3. The five PostgreSQL session actions are already
verified separately; this work supplies the three missing memory actions.

## Fixed contract

`ai-memory.operation.v1` identifies a durable operation by resolved workspace,
project and operation key. The immutable binding also contains the authenticated
actor storage key, caller client ID, action, P02 specification digest and canonical
request digest. A positive attempt number selects one dispatch. Transport trace,
current project pointers and current page state never replace these fields.

The MCP boundary will recompute the request digest from the original typed tool
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

Page writing will reserve an operation before entering the existing Wiki write
pipeline. One writer-issued claim authorizes one write. The page and its indexes
commit with the receipt in a single SQLite transaction. Sanitization, admission,
attribution, atomic file replacement and rollback stay in Wiki. A crash between
file replacement and database commit leaves Unknown and blocks redispatch; SQLite
cannot make a filesystem rename atomic with its transaction. This limitation must
be visible in documentation and recovery tests.

## Integration and acceptance still required

The public MCP surface will extend the existing three tools with an optional
operation stamp and add original-operation query/close. Existing calls keep their
current response shape. ScopeResolver and existing tool authorization remain the
entry points. SDK schemas, wrappers, tool coverage and routing documentation must
ship with the public implementation; capability remains disabled until then.

Runtime tests run only on remote k3s. Required evidence includes effect/receipt
rollback, concurrent claim and close, original results after restart and later
state changes, actual MCP response loss, nonempty recall, and P02's eight-action
flow. Store-only tests do not certify MCP, PlaneMem or the whole P02 candidate.
