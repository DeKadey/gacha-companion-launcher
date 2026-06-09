import { createContext, useContext } from 'react';

export const LANGUAGES = [
  { code: 'en',     name: 'English',                  native: 'English' },
  { code: 'fr',     name: 'French',                   native: 'Français' },
  { code: 'de',     name: 'German',                   native: 'Deutsch' },
  { code: 'es',     name: 'Spanish (Spain)',           native: 'Español (España)' },
  { code: 'es-419', name: 'Spanish (Lat. Am.)',        native: 'Español (Latinoamérica)' },
  { code: 'it',     name: 'Italian',                  native: 'Italiano' },
  { code: 'pt-BR',  name: 'Portuguese (Brazil)',       native: 'Português (Brasil)' },
  { code: 'pt-PT',  name: 'Portuguese (Portugal)',     native: 'Português (Portugal)' },
  { code: 'ru',     name: 'Russian',                  native: 'Русский' },
  { code: 'pl',     name: 'Polish',                   native: 'Polski' },
  { code: 'nl',     name: 'Dutch',                    native: 'Nederlands' },
  { code: 'ja',     name: 'Japanese',                 native: '日本語' },
  { code: 'ko',     name: 'Korean',                   native: '한국어' },
  { code: 'zh-CN',  name: 'Chinese (Simplified)',      native: '中文(简体)' },
  { code: 'zh-TW',  name: 'Chinese (Traditional)',     native: '中文(繁體)' },
  { code: 'ar',     name: 'Arabic',                   native: 'العربية' },
  { code: 'tr',     name: 'Turkish',                  native: 'Türkçe' },
  { code: 'sv',     name: 'Swedish',                  native: 'Svenska' },
  { code: 'no',     name: 'Norwegian',                native: 'Norsk' },
  { code: 'da',     name: 'Danish',                   native: 'Dansk' },
  { code: 'fi',     name: 'Finnish',                  native: 'Suomi' },
  { code: 'cs',     name: 'Czech',                    native: 'Čeština' },
  { code: 'hu',     name: 'Hungarian',                native: 'Magyar' },
  { code: 'ro',     name: 'Romanian',                 native: 'Română' },
  { code: 'th',     name: 'Thai',                     native: 'ภาษาไทย' },
  { code: 'id',     name: 'Indonesian',               native: 'Bahasa Indonesia' },
  { code: 'uk',     name: 'Ukrainian',                native: 'Українська' },
];

// Keys are English text; values are translations for that language.
// Languages not yet translated fall back to the key (English text).
const TRANSLATIONS = {
  en: {},
  fr: {}, de: {}, es: {}, 'es-419': {}, it: {}, 'pt-BR': {}, 'pt-PT': {},
  ru: {}, pl: {}, nl: {}, ja: {}, ko: {}, 'zh-CN': {}, 'zh-TW': {},
  ar: {}, tr: {}, sv: {}, no: {}, da: {}, fi: {}, cs: {}, hu: {}, ro: {},
  th: {}, id: {}, uk: {},
};

export const LangContext = createContext('en');
export const useLang = () => useContext(LangContext);

export function useT() {
  const lang = useContext(LangContext);
  return (key) => TRANSLATIONS[lang]?.[key] ?? key;
}
