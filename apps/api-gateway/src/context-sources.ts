import {
  isSyncIdentifier,
  validateSourceRef,
  type Classification,
  type ContextSourceCheck,
  type ContextSourceState,
  type ContextSourceReferenceCheck,
  type ContextConfirmationReadiness,
  type SourceRef,
} from '@planemem/contracts';
import { fingerprint } from './idempotency.js';
import type { RequestContext } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';

const MAX_NODES = 4096;
const MAX_DEPTH = 32;
const MAX_WORK = 1_000_000;
const classes: Classification[] = ['public', 'internal', 'confidential', 'restricted'];
type Row = {
  id: string;
  version: string | number;
  classification: Classification;
  status: string;
  title: string;
  content: unknown;
  source_refs: unknown;
  updated_at: string | Date;
  expires_at: string | Date | null;
  deleted_at: string | Date | null;
};
type Node = {
  id: string;
  version: number;
  classification: Classification;
  status: string;
  refs: SourceRef[];
  expires: number | null;
  archived: boolean;
  hash: string;
  invalid: boolean;
};
type Evaluation = {
  state: ContextSourceState;
  hash: string;
  expires: number | null;
  height: number;
};
export interface ContextSourceInspection {
  current: boolean;
  check: ContextSourceCheck;
  /** Stable closure digest, excluding request identity and the check timestamp. */
  hash: string;
  expires_at: string | null;
  reference_checks?: ContextSourceReferenceCheck[];
  confirmation_readiness?: ContextConfirmationReadiness;
}

/**
 * Use inside a repeatable-read transaction, or after the project's stream lock.
 * Locks must be requested only after the stream lock, matching item/proposal/pack writes.
 * Only authorized local rows enter the graph; diagnostics never reveal hidden IDs/content.
 */
export async function inspectContextSources(
  db: RuntimeSql,
  context: RequestContext,
  rootIds: string[],
  options: {
    lock?: boolean;
    require_confirmed?: boolean;
    reference_checks?: boolean;
    /** Evaluate strict confirmation readiness against the same loaded graph and timestamp. */
    confirmation_check?: boolean;
  } = {},
): Promise<Map<string, ContextSourceInspection>> {
  const roots = [...new Set(rootIds)].sort();
  if (!roots.length) return new Map();
  const nodes = new Map<string, Node | null>();
  let frontier = roots;
  const restricted = context.capability.includes('data.restricted.read');
  // Fetch each authorized node once, in bounded batches. Content is hashed then discarded.
  for (let depth = 0; frontier.length && depth <= MAX_DEPTH; depth++) {
    const ids = [...new Set(frontier)]
      .filter((id) => !nodes.has(id))
      .sort()
      .slice(0, MAX_NODES - nodes.size);
    if (!ids.length) break;
    const next = new Set<string>();
    for (let start = 0; start < ids.length; start += 64) {
      const batch = ids.slice(start, start + 64);
      const rows = await db<Row[]>`SELECT id, version, classification, status, title, content,
        source_refs, updated_at, expires_at, deleted_at FROM wcp_context_items
        WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id}
          AND project_id = ${context.project_id} AND (${restricted} OR classification <> 'restricted')
          AND id IN (SELECT jsonb_array_elements_text(${JSON.stringify(batch)}::jsonb))
        ORDER BY id ${db.unsafe(options.lock ? 'FOR SHARE' : '')}`;
      for (const id of batch) nodes.set(id, null);
      for (const row of rows) {
        const node = normalize(row);
        nodes.set(node.id, node);
        if (!node.invalid && !node.archived && ['proposed', 'confirmed'].includes(node.status))
          for (const ref of node.refs) if (ref.type === 'context-item') next.add(ref.id);
      }
    }
    frontier = [...next];
  }
  const now = Date.now();
  const checked_at = new Date(now).toISOString();
  let work = 0;
  const evaluate = (requireConfirmed: boolean): Map<string, ContextSourceInspection> => {
    // Healthy subgraphs are path-independent; failed cycles retain root-local traversal state.
    // Keep caches separate between normal use and strict confirmation; share the work limit.
    const healthy = new Map<string, Evaluation>();
    const results = new Map<string, ContextSourceInspection>();
    for (const root of roots) {
      const active = new Set<string>();
      const done = new Map<string, Evaluation>();
      const referenceChecks = new Map<number, ContextSourceReferenceCheck>();
      if (options.reference_checks)
        nodes.get(root)?.refs.forEach((ref, source_index) => {
          if (ref.type !== 'context-item') return;
          referenceChecks.set(
            source_index,
            validLocalRef(ref)
              ? { source_index, state: 'not-checked' }
              : { source_index, state: 'invalid', issue: 'reference' },
          );
        });
      const visit = (id: string, depth: number): Evaluation => {
        if (++work > MAX_WORK || depth > MAX_DEPTH) return terminal(id, 'limit');
        if (active.has(id)) return terminal(id, 'cycle');
        const known = healthy.get(id) ?? done.get(id);
        if (known && !(depth === 0 && (options.reference_checks || requireConfirmed)))
          return depth + known.height > MAX_DEPTH ? terminal(id, 'limit') : known;
        const node = nodes.get(id);
        if (node === undefined) return terminal(id, 'limit');
        if (node === null || node.archived) return terminal(id, 'unavailable');
        if (node.invalid) return terminal(id, 'invalid');
        if (node.status === 'excluded') return terminal(id, 'excluded', node.hash);
        if (node.status === 'expired' || (node.expires !== null && node.expires <= now))
          return terminal(id, 'expired', node.hash);
        if (requireConfirmed && depth === 0 && node.refs.length === 0)
          return terminal(id, 'invalid');
        active.add(id);
        let state: ContextSourceState = 'current';
        let expires = node.expires;
        let height = 0;
        const children: Array<{ id: string; revision: number; hash: string }> = [];
        const references = node.refs
          .map((ref, source_index) => ({ ref, source_index }))
          .filter(({ ref }) => ref.type === 'context-item')
          .sort((a, b) => compareRefs(a.ref, b.ref));
        for (const { ref, source_index } of references) {
          if (++work > MAX_WORK) {
            state = 'limit';
            break;
          }
          const source = nodes.get(ref.id);
          const child = visit(ref.id, depth + 1);
          let childState = child.state;
          let issue: ContextSourceReferenceCheck['issue'] =
            childState === 'current' ? undefined : 'dependency';
          if (source && !source.invalid && !source.archived && childState !== 'limit') {
            if (classes.indexOf(source.classification) > classes.indexOf(node.classification)) {
              childState = 'unavailable';
              issue = 'classification';
            } else if (source.version !== ref.revision) {
              childState = 'stale';
              issue = 'revision';
            } else if (
              (requireConfirmed || node.status === 'confirmed') &&
              source.status !== 'confirmed'
            ) {
              childState = 'stale';
              issue = 'confirmation';
            }
          }
          if (depth === 0 && options.reference_checks)
            referenceChecks.set(source_index, {
              source_index,
              state: childState,
              ...(issue === undefined ? {} : { issue }),
              ...(source && !source.invalid && !source.archived
                ? { current_revision: source.version }
                : {}),
            });
          if (state === 'current' && childState !== 'current') state = childState;
          if (childState === 'limit') state = 'limit';
          height = Math.max(height, child.height + 1);
          if (child.expires !== null)
            expires = expires === null ? child.expires : Math.min(expires, child.expires);
          children.push({
            id: ref.id,
            revision: ref.revision!,
            hash: fingerprint([childState, child.hash]),
          });
        }
        active.delete(id);
        const value = {
          state,
          height,
          expires,
          hash: fingerprint({ schema: 1, node: node.hash, state, children }),
        };
        done.set(id, value);
        if (state === 'current') healthy.set(id, value);
        return value;
      };
      const value = visit(root, 0);
      results.set(root, {
        current: value.state === 'current',
        check: { state: value.state, checked_at, scope: 'local-context-items' },
        hash: value.hash,
        expires_at: value.expires === null ? null : new Date(value.expires).toISOString(),
        ...(options.reference_checks ? { reference_checks: [...referenceChecks.values()] } : {}),
      });
    }
    return results;
  };
  const results = evaluate(options.require_confirmed === true);
  if (options.confirmation_check) {
    const confirmation = options.require_confirmed ? results : evaluate(true);
    for (const [root, result] of results) {
      const strict = confirmation.get(root)!;
      result.confirmation_readiness = {
        sources_current: strict.current,
        source_check: strict.check,
        ...(strict.reference_checks === undefined
          ? {}
          : { source_checks: strict.reference_checks }),
        effective_expires_at: strict.expires_at,
      };
    }
  }
  return results;
}

function terminal(id: string, state: ContextSourceState, hash?: string): Evaluation {
  return { state, hash: fingerprint({ schema: 1, id, state, hash }), expires: null, height: 0 };
}
function compareRefs(a: SourceRef, b: SourceRef) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : (a.revision ?? 0) - (b.revision ?? 0);
}
function validLocalRef(ref: SourceRef) {
  return (
    isSyncIdentifier(ref.id) &&
    ref.id !== '.' &&
    ref.id !== '..' &&
    ref.revision !== undefined &&
    Number.isSafeInteger(ref.revision) &&
    ref.revision > 0
  );
}
function normalize(row: Row): Node {
  const invalid: Node = {
    id: row.id,
    version: 0,
    classification: row.classification,
    status: row.status,
    refs: [],
    expires: null,
    archived: row.deleted_at !== null,
    hash: '',
    invalid: true,
  };
  try {
    const version = Number(row.version);
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      !classes.includes(row.classification) ||
      !['proposed', 'confirmed', 'excluded', 'expired'].includes(row.status) ||
      !Array.isArray(row.source_refs) ||
      row.source_refs.length > 32
    )
      return invalid;
    const refs = row.source_refs.map(validateSourceRef);
    // Retain only the root's already-visible references for repair hints if a pin is invalid.
    // Invalid nodes remain terminal and are never expanded or exposed as readable sources.
    invalid.refs = refs;
    for (const ref of refs) if (ref.type === 'context-item' && !validLocalRef(ref)) return invalid;
    const expires = row.expires_at === null ? null : new Date(row.expires_at).getTime();
    if (expires !== null && !Number.isFinite(expires)) return invalid;
    const hash = fingerprint({
      ...row,
      version,
      source_refs: refs,
      updated_at: new Date(row.updated_at).toISOString(),
      expires_at: expires === null ? null : new Date(expires).toISOString(),
      deleted_at: row.deleted_at === null ? null : new Date(row.deleted_at).toISOString(),
    });
    return {
      id: row.id,
      version,
      classification: row.classification,
      status: row.status,
      refs,
      expires,
      archived: row.deleted_at !== null,
      hash,
      invalid: false,
    };
  } catch {
    return invalid;
  }
}
