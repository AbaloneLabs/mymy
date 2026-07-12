import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Home,
  MessageSquare,
  Calendar,
  CheckSquare,
  NotebookPen,
  BookOpen,
  Share2,
  Bot,
  Wallet,
  HardDrive,
  Activity,
  LineChart,
  Target,
  Settings,
  Lock,
  Command,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldQuestion,
} from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { TopBar } from "@/components/TopBar";
import { CommandPalette } from "@/components/CommandPalette";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useLockApp } from "@/hooks/useLockApp";
import { cn } from "@/lib/utils";
import logoUrl from "@/assets/logo.svg";
import { usePendingDecisionCount } from "@/features/decisions/api";

interface AppLayoutProps {
  children: ReactNode;
}


export function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const lock = useLockApp();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("mymy:main-sidebar-collapsed") === "true";
  });
  const pendingDecisions = usePendingDecisionCount();

  // Register all global keyboard shortcuts (navigation sequences,
  // palette toggle, lock, context create keys).
  useGlobalShortcuts();

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("mymy:main-sidebar-collapsed", String(next));
      return next;
    });
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--bg)]">

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-[var(--border)] bg-[var(--bg)] transition-[width] duration-150 md:flex",
          collapsed ? "w-[64px]" : "w-[220px]",
        )}
      >

        <div className={cn("flex h-14 items-center", collapsed ? "justify-center px-2" : "px-4")}>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex min-w-0 items-center gap-2"
            title="mymy"
          >
            <img src={logoUrl} alt="mymy" className="h-7 w-7" />
            <span className={cn("text-sm font-semibold tracking-tight text-[var(--text)]", collapsed && "hidden")}>
              mymy
            </span>
          </button>
        </div>


        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {NAV_ITEMS.map((item) => {
            if (item.kind === "separator") {
              return (
                <div
                  key={item.id}
                  className="my-2 border-t border-[var(--border)]"
                />
              );
            }

            const isActive = location.pathname === item.path;
            const enabled = item.enabled;

            if (!enabled) {
              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-[var(--text-faint)] opacity-60",
                    collapsed && "justify-center px-0",
                  )}
                  title={`${t(item.labelKey)} · ${t("common.comingSoon")}`}
                >
                  <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span className={cn(collapsed && "hidden")}>{t(item.labelKey)}</span>
                </div>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.path)}
                title={t(item.labelKey)}
                className={cn(
                  "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150",
                  collapsed && "justify-center px-0",
                  isActive
                    ? "bg-[var(--surface-hover)] text-[var(--text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--accent)]" />
                )}
                <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span className={cn(collapsed && "hidden")}>{t(item.labelKey)}</span>
                {item.id === "decisions" && (
                  <DecisionCountBadge
                    count={pendingDecisions.data?.count}
                    failed={pendingDecisions.isError}
                    collapsed={collapsed}
                  />
                )}
              </button>
            );
          })}
        </nav>


        <div className="space-y-0.5 border-t border-[var(--border)] px-2 py-2">
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
              collapsed && "justify-center px-0",
            )}
            title={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            ) : (
              <PanelLeftClose className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            )}
            <span className={cn("flex-1 text-left", collapsed && "hidden")}>
              {collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => navigate("/shortcuts")}
            title={t("nav.commandPalette")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150",
              collapsed && "justify-center px-0",
              location.pathname === "/shortcuts"
                ? "bg-[var(--surface-hover)] text-[var(--text)]"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            )}
          >
            <Command className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className={cn("flex-1 text-left", collapsed && "hidden")}>{t("nav.commandPalette")}</span>
            <span className={cn("text-[10px] font-semibold text-[var(--text-faint)]", collapsed && "hidden")}>
              ⌘K
            </span>
          </button>
          <LanguageSwitcher collapsed={collapsed} />
          <SidebarButton
            label={t("nav.settings")}
            icon={Settings}
            active={location.pathname === "/settings"}
            onClick={() => navigate("/settings")}
            collapsed={collapsed}
          />
          <SidebarButton
            label={t("nav.lock")}
            icon={Lock}
            onClick={lock}
            collapsed={collapsed}
          />
        </div>
      </aside>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid h-14 grid-cols-5 border-t border-[var(--border)] bg-[var(--bg)] md:hidden"
        aria-label={t("nav.mobilePrimary")}
      >
        {NAV_ITEMS.filter(
          (item) =>
            item.kind === "item" &&
            ["home", "decisions", "chat", "agents", "journey"].includes(item.id),
        ).map((item) => {
          if (item.kind !== "item") return null;
          const active = location.pathname === item.path;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              aria-label={t(item.labelKey)}
              title={t(item.labelKey)}
              onClick={() => navigate(item.path)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 text-[10px]",
                active ? "text-[var(--accent)]" : "text-[var(--text-muted)]",
              )}
            >
              <item.icon className="h-4 w-4" strokeWidth={1.5} />
              <span>{t(item.labelKey)}</span>
              {item.id === "decisions" && (
                <DecisionCountBadge
                  count={pendingDecisions.data?.count}
                  failed={pendingDecisions.isError}
                  collapsed
                />
              )}
            </button>
          );
        })}
      </nav>


      <main
        className={cn(
          "flex h-dvh min-h-0 flex-1 flex-col transition-[padding-left] duration-150",
          "pb-14 pl-0 md:pb-0",
          collapsed ? "md:pl-[64px]" : "md:pl-[220px]",
        )}
      >
        <TopBar />
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </main>

      {/* Command palette overlay (Cmd+K) — global, within the layout */}
      <CommandPalette />
    </div>
  );
}


function SidebarButton({
  label,
  icon: Icon,
  active,
  onClick,
  collapsed,
}: {
  label: string;
  icon: typeof Home;
  active?: boolean;
  onClick: () => void;
  collapsed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150",
        collapsed && "justify-center px-0",
        active
          ? "bg-[var(--surface-hover)] text-[var(--text)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
      <span className={cn(collapsed && "hidden")}>{label}</span>
    </button>
  );
}


const NAV_ITEMS = [
  { kind: "item", id: "home", labelKey: "nav.home", icon: Home, path: "/", enabled: true },
  { kind: "item", id: "decisions", labelKey: "nav.decisions", icon: ShieldQuestion, path: "/decisions", enabled: true },
  { kind: "item", id: "chat", labelKey: "nav.chat", icon: MessageSquare, path: "/chat", enabled: true },
  { kind: "item", id: "agents", labelKey: "nav.agents", icon: Bot, path: "/agents", enabled: true },
  { kind: "item", id: "journey", labelKey: "nav.context", icon: Share2, path: "/journey", enabled: true },
  { kind: "separator", id: "work-separator" },
  { kind: "item", id: "goals", labelKey: "nav.goals", icon: Target, path: "/goals", enabled: true },
  { kind: "item", id: "calendar", labelKey: "nav.calendar", icon: Calendar, path: "/calendar", enabled: true },
  { kind: "item", id: "tasks", labelKey: "nav.tasks", icon: CheckSquare, path: "/tasks", enabled: true },
  { kind: "item", id: "knowledge", labelKey: "nav.knowledge", icon: BookOpen, path: "/knowledge", enabled: true },
  { kind: "item", id: "notes", labelKey: "nav.notes", icon: NotebookPen, path: "/notes", enabled: true },
  { kind: "separator", id: "files-separator" },
  { kind: "item", id: "drive", labelKey: "nav.drive", icon: HardDrive, path: "/drive", enabled: true },
  { kind: "item", id: "processes", labelKey: "nav.processes", icon: Activity, path: "/processes", enabled: true },
  { kind: "separator", id: "finance-separator" },
  { kind: "item", id: "finance", labelKey: "nav.finance", icon: Wallet, path: "/finance", enabled: true },
  { kind: "item", id: "investments", labelKey: "nav.investments", icon: LineChart, path: "/investments", enabled: true },
] as const;

function DecisionCountBadge({
  count,
  failed,
  collapsed,
}: {
  count: number | undefined;
  failed: boolean;
  collapsed: boolean;
}) {
  const { t } = useTranslation();
  if (!failed && (!count || count < 1)) return null;
  const label = failed ? "!" : count! > 99 ? "99+" : String(count);
  return (
    <span
      aria-label={
        failed
          ? t("decisions.pendingCountUnavailable")
          : t("decisions.pendingCount", { count })
      }
      className={cn(
        "ml-auto inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold",
        failed
          ? "bg-[var(--status-warning-bg)] text-[var(--status-warning)]"
          : "bg-[var(--accent)] text-white",
        collapsed && "absolute right-1 top-1 ml-0",
      )}
    >
      {label}
    </span>
  );
}
