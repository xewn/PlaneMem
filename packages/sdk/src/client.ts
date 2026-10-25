import {
  ContractError,
  type ProjectEntity,
  type RequestContext,
  validateEntity,
  validateRequestContext,
} from '@planemem/contracts';

export interface WcpRequest {
  method: 'GET' | 'POST';
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface WcpTransport {
  request<T = unknown>(request: WcpRequest): Promise<T>;
}

export class WcpClient {
  private readonly context: RequestContext;

  constructor(
    private readonly transport: WcpTransport,
    context: RequestContext,
  ) {
    this.context = validateRequestContext(context);
  }

  async createProject(project: ProjectEntity): Promise<ProjectEntity> {
    const validation = validateEntity('Project', project);
    if (!validation.valid) {
      throw new ContractError(validation.error.code, validation.error.message, {
        ...validation.error.details,
        trace_id: validation.error.trace_id,
        retryable: validation.error.retryable,
      });
    }
    const idempotencyKey = this.context.idempotency_key ?? project.external_id;
    const response = await this.transport.request<ProjectEntity>({
      method: 'POST',
      path: '/v1/projects',
      headers: {
        traceparent: this.context.trace_id,
        'idempotency-key': idempotencyKey,
        'x-tenant-id': this.context.tenant_id,
        'x-workspace-id': this.context.workspace_id,
        ...(this.context.project_id === undefined
          ? {}
          : { 'x-project-id': this.context.project_id }),
      },
      body: project,
    });
    const responseValidation = validateEntity('Project', response);
    if (!responseValidation.valid) {
      throw new ContractError(responseValidation.error.code, responseValidation.error.message, {
        ...responseValidation.error.details,
        trace_id: responseValidation.error.trace_id,
        retryable: responseValidation.error.retryable,
      });
    }
    return response as ProjectEntity;
  }
}
