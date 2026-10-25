import { createUlid, type SourceRef, type Ulid } from '@planemem/contracts';

export interface ProposalScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}

export interface Proposal extends ProposalScope {
  schema_version: 1;
  proposal_id: Ulid;
  actor_id: string;
  kind: 'decision' | 'risk' | 'next_step' | 'blocker' | 'brief';
  title: string;
  content: string;
  status: 'proposed' | 'verified' | 'rejected';
  revision: number;
  trace_id: string;
  source_refs: SourceRef[];
  provenance: { model_version: string; prompt_version: string; warnings: string[] };
}

export interface ProviderFailure {
  schema_version: 1;
  status: 'degraded';
  retryable: boolean;
  provider: string;
  message: string;
  trace_id: string;
  source_refs: SourceRef[];
}

export class ProposalService {
  private readonly proposals = new Map<string, Proposal>();
  private readonly idempotency = new Map<string, Proposal>();

  health(): { service: 'intelligence'; version: '0.1.0'; status: 'ok'; ready: true } {
    return { service: 'intelligence', version: '0.1.0', status: 'ok', ready: true };
  }

  createProposal(
    input: ProposalScope & {
      idempotency_key: string;
      trace_id: string;
      actor_id: string;
      kind: Proposal['kind'];
      title: string;
      content: string;
      source_refs: SourceRef[];
      model_version: string;
      prompt_version: string;
    },
  ): Proposal {
    const previous = this.idempotency.get(input.idempotency_key);
    if (previous !== undefined) return clone(previous);
    if (input.source_refs.length === 0) throw new Error('source_refs_required');
    const warnings = /ignore\s+(?:all\s+)?policy|execute\s+(?:shell|command)|system\s+prompt/i.test(
      input.content,
    )
      ? ['prompt_injection_suspected']
      : [];
    const proposal: Proposal = {
      schema_version: 1,
      proposal_id: createUlid(),
      tenant_id: input.tenant_id,
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      actor_id: input.actor_id,
      kind: input.kind,
      title: input.title,
      content: input.content,
      status: 'proposed',
      revision: 1,
      trace_id: input.trace_id,
      source_refs: input.source_refs.map((ref) => ({ ...ref })),
      provenance: {
        model_version: input.model_version,
        prompt_version: input.prompt_version,
        warnings,
      },
    };
    this.proposals.set(proposal.proposal_id, proposal);
    this.idempotency.set(input.idempotency_key, proposal);
    return clone(proposal);
  }

  list(scope: ProposalScope): Proposal[] {
    return [...this.proposals.values()]
      .filter(
        (proposal) =>
          proposal.tenant_id === scope.tenant_id &&
          proposal.workspace_id === scope.workspace_id &&
          proposal.project_id === scope.project_id,
      )
      .map(clone);
  }

  confirmProposal(
    proposal_id: string,
    input: { actor_id: string; trace_id: string; expected_revision?: number },
  ): Proposal {
    const proposal = this.get(proposal_id);
    if (input.expected_revision !== undefined && proposal.revision !== input.expected_revision)
      throw new Error('VERSION_CONFLICT');
    proposal.status = 'verified';
    proposal.revision += 1;
    proposal.actor_id = input.actor_id;
    proposal.trace_id = input.trace_id;
    return clone(proposal);
  }

  rejectProposal(proposal_id: string, input: { actor_id: string; trace_id: string }): Proposal {
    const proposal = this.get(proposal_id);
    proposal.status = 'rejected';
    proposal.revision += 1;
    proposal.actor_id = input.actor_id;
    proposal.trace_id = input.trace_id;
    return clone(proposal);
  }

  handleProviderFailure(
    input: ProposalScope & { trace_id: string; provider: string; message: string },
  ): ProviderFailure {
    return {
      schema_version: 1,
      status: 'degraded',
      retryable: true,
      provider: input.provider,
      message: input.message,
      trace_id: input.trace_id,
      source_refs: [{ type: 'provider', id: input.provider }],
    };
  }

  private get(proposal_id: string): Proposal {
    const proposal = this.proposals.get(proposal_id);
    if (proposal === undefined) throw new Error('PROPOSAL_NOT_FOUND');
    return proposal;
  }
}

function clone(proposal: Proposal): Proposal {
  return {
    ...proposal,
    source_refs: proposal.source_refs.map((ref) => ({ ...ref })),
    provenance: { ...proposal.provenance, warnings: [...proposal.provenance.warnings] },
  };
}
