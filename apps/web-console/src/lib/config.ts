export const runtimeConfig = {
  issuer: process.env.AUTH_SERVER_ISSUER ?? 'http://localhost:44335',
  clientId: process.env.AUTH_SERVER_CLIENT_ID ?? 'PlaneMem_WebConsole',
  clientSecret: process.env.AUTH_SERVER_CLIENT_SECRET ?? '',
  audience: process.env.AUTH_SERVER_AUDIENCE ?? 'Base',
  scope: process.env.AUTH_SERVER_SCOPE ?? 'openid profile email roles offline_access Base',
  sessionSecret: process.env.AUTH_SESSION_SECRET ?? 'development-only-change-me',
  appUrl: process.env.WEB_CONSOLE_URL ?? 'http://localhost:3001',
  apiUrl: process.env.WORKBENCH_API_URL ?? 'http://localhost:3000',
  tenantId: process.env.WORKBENCH_TENANT_ID ?? '',
  workspaceId: process.env.WORKBENCH_WORKSPACE_ID ?? '',
  projectId: process.env.WORKBENCH_PROJECT_ID ?? '',
};

export function redirectUri(): string {
  return `${runtimeConfig.appUrl.replace(/\/$/, '')}/auth/callback`;
}
