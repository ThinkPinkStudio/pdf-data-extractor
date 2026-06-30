'use client'

// i18n identico all'app (src/renderer/src/i18n/index.js): stesse risorse it/en.
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import it from './locales/it.json'
import en from './locales/en.json'

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      it: { translation: it },
      en: { translation: en },
    },
    lng: 'it',
    fallbackLng: 'it',
    interpolation: { escapeValue: false },
  })
}

export default i18n
