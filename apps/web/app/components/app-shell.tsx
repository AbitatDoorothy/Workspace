import type { ReactNode } from "react";

import { navItems, type ActiveNav } from "./nav-items";

interface AppShellProps {
  active: ActiveNav;
  children: ReactNode;
}

interface IconProps {
  children: string;
  className?: string;
  filled?: boolean;
}

export function AppShell({ active, children }: AppShellProps) {
  return (
    <div className="app-frame">
      <aside className="side-nav" aria-label="Workspace navigation">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Icon>terminal</Icon>
          </div>
          <div>
            <strong>Abitat Workspace</strong>
            <span>
              <span className="daemon-dot" aria-hidden="true" />
              Daemon: Online
            </span>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <a
              className={`nav-item ${item.active === active ? "nav-item-active" : ""}`}
              href={item.href}
              key={item.href}
            >
              <Icon filled={item.active === active}>{item.icon}</Icon>
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        <div className="side-nav-footer">
          <form action="/api/logout" method="post">
            <button className="nav-item nav-button" type="submit">
              <Icon>logout</Icon>
              <span>Log out</span>
            </button>
          </form>
          <a className="nav-item" href="/projects">
            <Icon>settings</Icon>
            <span>Settings</span>
          </a>
          <button className="switch-workspace" type="button">
            <Icon>swap_horiz</Icon>
            Switch Workspace
          </button>
        </div>
      </aside>

      <main className="app-main">{children}</main>
    </div>
  );
}

export function Icon({ children, className, filled }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined ${className ?? ""}`}
      style={{ fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24` }}
    >
      {children}
    </span>
  );
}
