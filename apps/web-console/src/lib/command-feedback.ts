import { revalidatePath } from 'next/cache';
import { AuthRequiredError, WorkbenchApiError } from './server-api';

export function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function commandFailure(error: unknown, path: string) {
  const status = 'error' as const;
  if (error instanceof AuthRequiredError) return { status, message: 'Sign in again to continue.' };
  if (error instanceof WorkbenchApiError) {
    if (error.status === 404 || error.status === 409) revalidatePath(path);
    return {
      status,
      message: error.message,
      trace: error.trace_id,
      uncertain: error.status === undefined || error.status >= 500,
    };
  }
  return {
    status,
    uncertain: true,
    message: 'The gateway did not confirm this operation. Retry to check its result.',
  };
}
