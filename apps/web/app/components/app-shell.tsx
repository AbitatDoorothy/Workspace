import type { ReactNode } from "react";

type ActiveNav = "dashboard" | "projects" | "agents" | "queue";

const navItems: Array<{ active: ActiveNav; href: string; icon: string; label: string }> = [
  { active: "dashboard", href: "/", icon: "dashboard", label: "Dashboard" },
  { active: "projects", href: "/projects", icon: "folder_managed", label: "Projects" },
  { active: "agents", href: "/agents", icon: "smart_toy", label: "Agents" },
  { active: "queue", href: "/conversations", icon: "slow_motion_video", label: "Queue" }
];

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
          <a className="nav-item" href="/projects">
            <Icon>settings</Icon>
            <span>Settings</span>
          </a>
          <a className="nav-item" href="/conversations">
            <Icon>contact_support</Icon>
            <span>Support</span>
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
