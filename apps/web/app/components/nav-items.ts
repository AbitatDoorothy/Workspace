export type ActiveNav = "dashboard" | "projects";

export const navItems: Array<{ active: ActiveNav; href: string; icon: string; label: string }> = [
  { active: "dashboard", href: "/", icon: "dashboard", label: "Dashboard" },
  { active: "projects", href: "/projects", icon: "folder_managed", label: "Projects" }
];
