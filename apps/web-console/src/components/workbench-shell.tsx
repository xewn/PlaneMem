'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon, LogoMark } from './icons';

const navItems = [
  { href: '/overview', label: 'Project Overview', icon: 'home' },
  { href: '/work-items', label: 'Work Items', icon: 'work' },
  { href: '/context', label: 'Context', icon: 'context' },
  { href: '/sessions', label: 'Sessions', icon: 'sessions' },
  { href: '/handoffs', label: 'Handoffs', icon: 'handoffs' },
  { href: '/conflicts', label: 'Conflicts', icon: 'conflicts' },
  { href: '/audit', label: 'Audit', icon: 'audit' },
  { href: '/admin', label: 'Admin', icon: 'admin' },
] as const;

export function WorkbenchShell({ children, actor }: { children: ReactNode; actor?: string }) {
  const pathname = usePathname();
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) return <>{children}</>;
  const active = pathname === '/' ? '/overview' : pathname;
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand">
          <LogoMark />
          <div>
            <strong>PlaneMem Workbench</strong>
            <span>PlaneMem / Work Continuity Platform</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Primary">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${active === item.href ? 'is-active' : ''}`}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-project">
          <span className="eyebrow">CURRENT PROJECT</span>
          <strong>PlaneMem / Work Continuity Platform</strong>
          <p>Keep work moving across AI clients.</p>
          <div className="sidebar-sync">
            <i /> Live · request scoped
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="mobile-brand">
            <LogoMark />
            <strong>PlaneMem Workbench</strong>
          </div>
          <div className="project-select">
            <span>PlaneMem / Work Continuity Platform</span>
            <Icon name="chevron" />
          </div>
          <div className="topbar-right">
            <div className="live-pill">
              <i /> LIVE <span>· fresh query</span>
            </div>
            <div className="health-pill">
              <span>⌂</span> Connected
            </div>
            <div className="global-search">
              <Icon name="search" />
              <span>Search...</span>
            </div>
            <button className="icon-button" aria-label="Notifications">
              <Icon name="bell" />
            </button>
            <div className="avatar">{actor?.slice(0, 1).toUpperCase() ?? 'U'}</div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
