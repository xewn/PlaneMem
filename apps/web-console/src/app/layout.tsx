import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getSession } from '../lib/auth';
import { WorkbenchShell } from '../components/workbench-shell';
import '../styles.css';

export const metadata: Metadata = {
  title: 'PlaneMem Workbench',
  description: 'Work continuity platform console',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const actor = session?.name ?? session?.preferred_username ?? session?.email;
  return (
    <html lang="en">
      <body>
        <WorkbenchShell actor={actor}>{children}</WorkbenchShell>
      </body>
    </html>
  );
}
