export type ActiveNav = "dashboard" | "projects" | "todo";

export const navItems: Array<{ active: ActiveNav; href: string; icon: string; label: string }> = [
  { active: "dashboard", href: "/", icon: "dashboard", label: "Dashboard" },
  { active: "projects", href: "/projects", icon: "folder_managed", label: "Projects" },
  { active: "todo", href: "/todo", icon: "checklist", label: "To-Do" }
];
