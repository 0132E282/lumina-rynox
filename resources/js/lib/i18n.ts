import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import enCommon from '@/locales/en/common.json';
import viCommon from '@/locales/vi/common.json';

i18n.use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            en: { common: enCommon },
            vi: { common: viCommon },
        },
        fallbackLng: 'vi',
        defaultNS: 'common',
        interpolation: {
            escapeValue: false,
        },
    });

export default i18n;
