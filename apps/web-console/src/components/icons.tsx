import type { SVGProps } from 'react';

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: string }) {
  const paths: Record<string, string> = {
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    work: 'M4 5h16v14H4zM8 3v4M16 3v4M4 10h16',
    context:
      'M12 3a6 6 0 0 0-6 6v2a4 4 0 0 0 4 4h1v4h2v-4h1a4 4 0 0 0 4-4V9a6 6 0 0 0-6-6zM9 9h6M9 12h6',
    sessions: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
    handoffs: 'M4 7h12m0 0-3-3m3 3-3 3M20 17H8m0 0 3-3m-3 3 3 3',
    conflicts: 'M12 3 2 21h20L12 3zm0 6v5m0 3h.01',
    audit: 'M6 3h12v18H6zM9 7h6M9 11h6M9 15h4',
    admin:
      'M12 3l2 3 3 .5.5 3 2 2-2 2-.5 3-3 .5-2 3-2-3-3-.5-.5-3-2-2 2-2 .5-3 3-.5 2-3 2zm0 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    search: 'm20 20-4.5-4.5M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h6',
    chevron: 'm8 10 4 4 4-4',
    arrow: 'M5 12h14m-5-5 5 5-5 5',
    refresh: 'M20 11a8 8 0 1 0 1 4m-1-8v4h-4',
    external: 'M14 5h5v5m-1-4-8 8M5 7v12h12',
    close: 'm6 6 12 12M18 6 6 18',
    check: 'm5 12 4 4L19 6',
    clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    database: 'M4 6c0 2 16 2 16 0M4 6v6c0 2 16 2 16 0V6M4 12v6c0 2 16 2 16 0v-6',
    users:
      'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1m7-9a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm6-7a4 4 0 0 1 0 7.7',
    target: 'M12 3v3m0 12v3M3 12h3m12 0h3M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 3v2l2 1',
    flag: 'M5 21V4m0 0c4-3 7 3 14 0v9c-7 3-10-3-14 0',
    activity: 'M3 12h4l2-6 4 12 2-6h6',
    decision: 'M12 3l2.2 5.1L20 9l-4 3.8 1 5.7-5-2.7-5 2.7 1-5.7L4 9l5.8-.9L12 3z',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] ?? paths.grid} />
    </svg>
  );
}

export function LogoMark() {
  return (
    <div className="logo-mark">
      <Icon name="grid" />
    </div>
  );
}
