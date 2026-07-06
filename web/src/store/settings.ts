import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppSettings, GitSystemConfig, GitSystemType, Language } from "@/types/settings";



const APP_VERSION = "0.1.0";

const DEFAULT_SETTINGS: AppSettings = {

  language: "en",

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

  updateGitSystem: (type: GitSystemType, patch: Partial<GitSystemConfig>) => void;

  resetSettings: () => void;
}


export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      appVersion: APP_VERSION,

      setLanguage: (lang) =>
        set((state) => ({
          settings: { ...state.settings, language: lang },
        })),

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
