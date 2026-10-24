import { WorkbenchApi, type ProjectSummary, type ViewState, type WorkbenchScope } from '../lib/api';

export class WorkbenchStore {
  projects: ViewState<ProjectSummary[]> = {
    status: 'loading',
    trace_id: 'trace_workbench_initial',
  };
  constructor(private readonly api: WorkbenchApi) {}
  async loadProjects(scope: WorkbenchScope): Promise<ViewState<ProjectSummary[]>> {
    this.projects =
      this.projects.data === undefined
        ? { status: 'loading', trace_id: 'trace_workbench_projects' }
        : { status: 'loading', data: this.projects.data, trace_id: 'trace_workbench_projects' };
    try {
      const response = await this.api.projects(scope);
      this.projects =
        response.data.length === 0
          ? { status: 'empty', data: [], trace_id: response.trace_id }
          : {
              status: 'ready',
              data: response.data,
              trace_id: response.trace_id,
              source_refs: response.source_refs,
            };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Project query failed';
      this.projects = {
        status: message.includes('DENIED') ? 'denied' : 'error',
        message,
        trace_id: 'trace_workbench_projects_error',
        ...(this.projects.data === undefined ? {} : { data: this.projects.data }),
      };
    }
    return this.projects;
  }
  markStale(): ViewState<ProjectSummary[]> {
    if (this.projects.status === 'ready') this.projects = { ...this.projects, status: 'stale' };
    return this.projects;
  }
}

export function renderProjectDashboard(state: ViewState<ProjectSummary[]>) {
  return {
    title: 'Work first',
    rows:
      state.data?.map((project) => ({
        project_id: project.project_id,
        name: project.name,
        open_work_items: project.open_work_items,
      })) ?? [],
    state: state.status,
  };
}
