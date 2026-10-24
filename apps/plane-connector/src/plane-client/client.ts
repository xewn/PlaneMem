import { ContractError } from '@planemem/contracts';

export interface PlaneTransportRequest {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface PlaneTransportResponse<T> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

export interface PlaneTransport {
  request<T>(request: PlaneTransportRequest): Promise<PlaneTransportResponse<T>>;
}

export interface PlaneClientConfig {
  base_url: string;
  api_token: string;
  workspace_slug: string;
  trace_id: string;
  max_retries?: number;
}

export interface PlaneProject {
  id: string;
  version?: number;
  [key: string]: unknown;
}

export interface PlaneWorkItem {
  id: string;
  version?: number;
  [key: string]: unknown;
}

export interface PlaneAttachmentPage {
  items: unknown[];
  has_more: boolean;
  next_cursor?: string;
}

export class PlaneClient {
  constructor(
    private readonly transport: PlaneTransport,
    private readonly config: PlaneClientConfig,
  ) {
    if (!/^https?:\/\//.test(config.base_url) || config.api_token.length === 0) {
      throw new TypeError('Plane client requires an HTTP base URL and API token');
    }
  }

  getProject(projectId: string): Promise<PlaneProject> {
    return this.request<PlaneProject>(
      'GET',
      `/api/workspaces/${this.config.workspace_slug}/projects/${projectId}`,
    );
  }

  createWorkItem(
    projectId: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<PlaneWorkItem> {
    if (idempotencyKey.length === 0) throw new TypeError('idempotency key is required');
    return this.request<PlaneWorkItem>('POST', `/api/projects/${projectId}/issues`, payload, {
      'idempotency-key': idempotencyKey,
    });
  }

  updateWorkItem(
    projectId: string,
    workItemId: string,
    patch: Record<string, unknown>,
    ifMatch: string,
  ): Promise<PlaneWorkItem> {
    return this.request<PlaneWorkItem>(
      'PATCH',
      `/api/projects/${projectId}/issues/${workItemId}`,
      patch,
      {
        'if-match': ifMatch,
      },
    );
  }

  listAttachments(
    projectId: string,
    workItemId: string,
    cursor?: string,
  ): Promise<PlaneAttachmentPage> {
    const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
    return this.request<PlaneAttachmentPage>(
      'GET',
      `/api/projects/${projectId}/issues/${workItemId}/attachments${query}`,
    );
  }

  private async request<T>(
    method: PlaneTransportRequest['method'],
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const retryableRead = method === 'GET';
    const maxRetries = this.config.max_retries ?? 2;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const response = await this.transport.request<T>({
        method,
        path,
        headers: {
          authorization: `Bearer ${this.config.api_token}`,
          'x-trace-id': this.config.trace_id,
          ...extraHeaders,
        },
        ...(body === undefined ? {} : { body }),
      });
      if (response.status >= 200 && response.status < 300) return response.data;
      if (
        retryableRead &&
        (response.status === 429 || response.status >= 500) &&
        attempt < maxRetries
      ) {
        continue;
      }
      throw new ContractError('PLANE_API_ERROR', `Plane API returned HTTP ${response.status}`, {
        status: response.status,
        path,
        trace_id: this.config.trace_id,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    throw new ContractError('PLANE_API_ERROR', 'Plane API request exhausted retries', {
      path,
      trace_id: this.config.trace_id,
      retryable: true,
    });
  }
}
