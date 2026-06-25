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
  Bot,
  Wallet,
  Target,
  Settings,
  Lock,
  Command,
} from "lucide-react";
import { useAuthStore } from "@/store/auth";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { TopBar } from "@/components/TopBar";
import { CommandPalette } from "@/components/CommandPalette";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { cn } from "@/lib/utils";
import logoUrl from "@/assets/logo.svg";

interface AppLayoutProps {
  children: ReactNode;
}


export function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const lock = useAuthStore((s) => s.lock);
  const { t } = useTranslation();

  // Register all global keyboard shortcuts (navigation sequences,
  // palette toggle, lock, context create keys).
  useGlobalShortcuts();

  // TopBar is shown on all pages except Home (`/`).
  const showTopBar = location.pathname !== "/";

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--bg)]">

      <aside className="fixed inset-y-0 left-0 z-20 flex w-[220px] flex-col border-r border-[var(--border)] bg-[var(--bg)]">

        <div className="flex h-14 items-center px-4">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center gap-2"
          >
            <img src={logoUrl} alt="mymy" className="h-7 w-7" />
            <span className="text-sm font-semibold tracking-tight text-[var(--text)]">
              mymy
            </span>
          </button>
        </div>


        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.path;
            const enabled = item.enabled;

            if (!enabled) {
              return (
                <div
                  key={item.id}
                  className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-[var(--text-faint)] opacity-60"
                  title={t("common.comingSoon")}
                >
                  <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span>{t(item.labelKey)}</span>
                </div>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.path)}
                className={cn(
                  "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150",
                  isActive
                    ? "bg-[var(--surface-hover)] text-[var(--text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--accent)]" />
                )}
                <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span>{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>


        <div className="space-y-0.5 border-t border-[var(--border)] px-2 py-2">
          <button
            type="button"
            onClick={() => navigate("/shortcuts")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150",
              location.pathname === "/shortcuts"
                ? "bg-[var(--surface-hover)] text-[var(--text)]"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            )}
          >
            <Command className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className="flex-1 text-left">{t("nav.commandPalette")}</span>
            <span className="text-[10px] font-semibold text-[var(--text-faint)]">
              ⌘K
            </span>
          </button>
          <LanguageSwitcher />
          <SidebarButton
            label={t("nav.settings")}
            icon={Settings}
            active={location.pathname === "/settings"}
            onClick={() => navigate("/settings")}
          />
          <SidebarButton
            label={t("nav.lock")}
            icon={Lock}
            onClick={lock}
          />
        </div>
      </aside>


      <main className="flex h-dvh min-h-0 flex-1 flex-col pl-[220px]">
        {showTopBar && <TopBar />}
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
}: {
  label: string;
  icon: typeof Home;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150",
        active
          ? "bg-[var(--surface-hover)] text-[var(--text)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
      <span>{label}</span>
    </button>
  );
}


const NAV_ITEMS = [
  { id: "home", labelKey: "nav.home", icon: Home, path: "/", enabled: true },
  { id: "chat", labelKey: "nav.chat", icon: MessageSquare, path: "/chat", enabled: true },
  { id: "calendar", labelKey: "nav.calendar", icon: Calendar, path: "/calendar", enabled: true },
  { id: "notes", labelKey: "nav.notes", icon: NotebookPen, path: "/notes", enabled: true },
  { id: "knowledge", labelKey: "nav.knowledge", icon: BookOpen, path: "/knowledge", enabled: true },
  { id: "tasks", labelKey: "nav.tasks", icon: CheckSquare, path: "/tasks", enabled: true },
  { id: "goals", labelKey: "nav.goals", icon: Target, path: "/goals", enabled: true },
  { id: "agents", labelKey: "nav.agents", icon: Bot, path: "/agents", enabled: true },
  { id: "finance", labelKey: "nav.finance", icon: Wallet, path: "/finance", enabled: true },
] as const;
