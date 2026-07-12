
import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", short: "EN" },
  { code: "ko", label: "한국어", short: "KO" },
  { code: "zh", label: "中文", short: "ZH" },
  { code: "ja", label: "日本語", short: "JA" },
] as const;

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    lng: "en",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  });


export function syncHtmlLang(lang: string): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang;
  }
}

/**
 * Load non-default language resources only when the user selects them.
 *
 * Shipping all four catalogs in the entry chunk delayed every first visit,
 * even though one locale is active at a time. Resource registration precedes
 * the language transition so components never render raw keys between the
 * chunk arrival and i18next activation.
 */
export async function changeAppLanguage(lang: string): Promise<void> {
  if (lang !== "en" && !i18n.hasResourceBundle(lang, "translation")) {
    const loaders: Record<
      string,
      () => Promise<{ default: Record<string, unknown> }>
    > = {
      ko: () => import("./locales/ko"),
      zh: () => import("./locales/zh"),
      ja: () => import("./locales/ja"),
    };
    const loader = loaders[lang];
    if (!loader) throw new Error(`Unsupported language: ${lang}`);
    const resources = await loader();
    i18n.addResourceBundle(lang, "translation", resources.default, true, false);
  }
  await i18n.changeLanguage(lang);
  syncHtmlLang(lang);
}


syncHtmlLang(i18n.language);

export default i18n;
