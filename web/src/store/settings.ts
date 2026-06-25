import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AgentSystemInstance, AgentSystemType, AppSettings, GitSystemConfig, GitSystemType, Language } from "@/types/settings";



const APP_VERSION = "0.1.0";

const DEFAULT_SETTINGS: AppSettings = {

  language: "en",

  agentSystems: [],
  gitSystems: {
    github: {
      type: "github",
      enabled: false,
      host: "github.com",
      port: 22,
      sshAlias: "",
      username: "",
    },
    gitlab: {
      type: "gitlab",
      enabled: false,
      host: "",
      port: 22,
      sshAlias: "",
      username: "git",
    },
    gitea: {
      type: "gitea",
      enabled: false,
      host: "",
      port: 22,
      sshAlias: "",
      username: "git",
    },
  },
};
interface SettingsState {
  settings: AppSettings;
  appVersion: string;


  setLanguage: (lang: Language) => void;

  addAgentSystem: (instance: Omit<AgentSystemInstance, "id">) => void;

  updateAgentSystem: (id: string, patch: Partial<AgentSystemInstance>) => void;

  removeAgentSystem: (id: string) => boolean;

  redetectLocal: () => Promise<void>;

  updateGitSystem: (type: GitSystemType, patch: Partial<GitSystemConfig>) => void;

  resetSettings: () => void;
}


function genId(type: AgentSystemType): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      appVersion: APP_VERSION,

      setLanguage: (lang) =>
        set((state) => ({
          settings: { ...state.settings, language: lang },
        })),

      addAgentSystem: (instance) =>
        set((state) => ({
          settings: {
            ...state.settings,
            agentSystems: [
              ...state.settings.agentSystems,
              { ...instance, id: genId(instance.type), source: "manual" },
            ],
          },
        })),

      updateAgentSystem: (id, patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            agentSystems: state.settings.agentSystems.map((inst) =>
              inst.id === id ? { ...inst, ...patch } : inst
            ),
          },
        })),

      removeAgentSystem: (id) => {
        const inst = get().settings.agentSystems.find((i) => i.id === id);

        if (!inst || inst.source === "auto") return false;
        set((state) => ({
          settings: {
            ...state.settings,
            agentSystems: state.settings.agentSystems.filter((i) => i.id !== id),
          },
        }));
        return true;
      },

      redetectLocal: async () => {



        void get;
      },

      updateGitSystem: (type, patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            gitSystems: {
              ...state.settings.gitSystems,
              [type]: { ...state.settings.gitSystems[type], ...patch },
            },
          },
        })),

      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: "mymy-settings",
      version: 3,


      migrate: (persisted: unknown, version: number) => {
        if (!persisted || typeof persisted !== "object") return DEFAULT_SETTINGS;
        const prev = persisted as Partial<AppSettings>;

        if (version < 2) return DEFAULT_SETTINGS;

        return {
          ...DEFAULT_SETTINGS,
          ...prev,
          language: prev.language ?? "en",
        };
      },
    }
  )
);
