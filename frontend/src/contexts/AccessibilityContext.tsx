import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  hydratePersistedSettingFromElectron,
  readPersistedSetting,
  writePersistedSetting,
} from '../utils/persistentSettings'

export type AppTheme = 'dark' | 'light'
export type AppFontFamily = 'default' | 'open-dyslexic'

const THEME_STORAGE_KEY = 'app-theme'
const FONT_SCALE_STORAGE_KEY = 'app-font-scale-percent'
const FONT_FAMILY_STORAGE_KEY = 'app-font-family'

const DEFAULT_THEME: AppTheme = 'dark'
const DEFAULT_FONT_FAMILY: AppFontFamily = 'default'
export const DEFAULT_FONT_SCALE_PERCENT = 100
export const MIN_FONT_SCALE_PERCENT = 100
export const MAX_FONT_SCALE_PERCENT = 150

const THEME_RGB_TOKENS: Record<AppTheme, Record<string, string>> = {
  dark: {
    '--color-surface-base-rgb': '15 18 22',
    '--color-surface-raised-rgb': '21 25 32',
    '--color-surface-overlay-rgb': '27 32 40',
    '--color-surface-border-rgb': '39 45 56',
    '--color-accent-primary-rgb': '91 141 239',
    '--color-accent-secondary-rgb': '34 211 238',
    '--color-accent-warm-rgb': '232 162 58',
    '--color-accent-warm-dim-rgb': '196 126 34',
    '--color-text-primary-rgb': '240 238 244',
    '--color-text-secondary-rgb': '155 150 168',
    '--color-text-muted-rgb': '107 101 120',
    '--color-scrollbar-track-rgb': '37 34 41',
    '--color-scrollbar-thumb-rgb': '91 141 239',
  },
  light: {
    '--color-surface-base-rgb': '255 255 255',
    '--color-surface-raised-rgb': '255 255 255',
    '--color-surface-overlay-rgb': '248 251 255',
    '--color-surface-border-rgb': '209 219 232',
    '--color-accent-primary-rgb': '45 98 194',
    '--color-accent-secondary-rgb': '12 137 175',
    '--color-accent-warm-rgb': '242 145 43',
    '--color-accent-warm-dim-rgb': '214 118 24',
    '--color-text-primary-rgb': '15 23 42',
    '--color-text-secondary-rgb': '51 65 85',
    '--color-text-muted-rgb': '100 116 139',
    '--color-scrollbar-track-rgb': '236 241 247',
    '--color-scrollbar-thumb-rgb': '125 141 162',
  },
}

const FONT_FAMILY_TOKENS: Record<AppFontFamily, string> = {
  default: "'Outfit', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  'open-dyslexic': "'OpenDyslexic', 'Open Dyslexic', 'OpenDyslexicAlta', system-ui, sans-serif",
}

interface AccessibilityContextValue {
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
  fontScalePercent: number
  setFontScalePercent: (percent: number) => void
  fontFamily: AppFontFamily
  setFontFamily: (fontFamily: AppFontFamily) => void
  resetAccessibility: () => void
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null)

const isTheme = (value: string | null): value is AppTheme =>
  value === 'dark' || value === 'light'

const isFontFamily = (value: string | null): value is AppFontFamily =>
  value === 'default' || value === 'open-dyslexic'

const clampFontScalePercent = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_FONT_SCALE_PERCENT
  return Math.max(MIN_FONT_SCALE_PERCENT, Math.min(MAX_FONT_SCALE_PERCENT, Math.round(value)))
}

const parseFontScalePercent = (value: string | null): number => {
  if (!value) return DEFAULT_FONT_SCALE_PERCENT
  const parsed = Number.parseInt(value, 10)
  return clampFontScalePercent(parsed)
}

const applyAccessibilityToDocument = (
  theme: AppTheme,
  fontScalePercent: number,
  fontFamily: AppFontFamily,
): void => {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  const rgbTokens = THEME_RGB_TOKENS[theme]
  for (const [name, value] of Object.entries(rgbTokens)) {
    root.style.setProperty(name, value)
  }

  root.dataset.theme = theme
  root.dataset.fontFamily = fontFamily
  root.style.colorScheme = theme
  root.style.setProperty('--app-font-family-sans', FONT_FAMILY_TOKENS[fontFamily])
  root.style.setProperty('--app-font-scale-factor', String(fontScalePercent / 100))
  root.style.fontSize = `${fontScalePercent}%`
}

export function useAccessibility() {
  const context = useContext(AccessibilityContext)
  if (!context) throw new Error('useAccessibility must be used within AccessibilityProvider')
  return context
}

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => {
    const savedTheme = readPersistedSetting(THEME_STORAGE_KEY)
    return isTheme(savedTheme) ? savedTheme : DEFAULT_THEME
  })
  const [fontScalePercent, setFontScalePercentState] = useState<number>(() => {
    const savedScale = readPersistedSetting(FONT_SCALE_STORAGE_KEY)
    return parseFontScalePercent(savedScale)
  })
  const [fontFamily, setFontFamilyState] = useState<AppFontFamily>(() => {
    const savedFontFamily = readPersistedSetting(FONT_FAMILY_STORAGE_KEY)
    return isFontFamily(savedFontFamily) ? savedFontFamily : DEFAULT_FONT_FAMILY
  })

  useLayoutEffect(() => {
    applyAccessibilityToDocument(theme, fontScalePercent, fontFamily)
  }, [theme, fontScalePercent, fontFamily])

  useEffect(() => {
    let isDisposed = false

    void (async () => {
      const [savedTheme, savedScale, savedFontFamily] = await Promise.all([
        hydratePersistedSettingFromElectron(THEME_STORAGE_KEY),
        hydratePersistedSettingFromElectron(FONT_SCALE_STORAGE_KEY),
        hydratePersistedSettingFromElectron(FONT_FAMILY_STORAGE_KEY),
      ])
      if (isDisposed) return

      setThemeState(isTheme(savedTheme) ? savedTheme : DEFAULT_THEME)
      setFontScalePercentState(parseFontScalePercent(savedScale))
      setFontFamilyState(isFontFamily(savedFontFamily) ? savedFontFamily : DEFAULT_FONT_FAMILY)
    })()

    return () => {
      isDisposed = true
    }
  }, [])

  useEffect(() => {
    writePersistedSetting(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    writePersistedSetting(FONT_SCALE_STORAGE_KEY, String(fontScalePercent))
  }, [fontScalePercent])

  useEffect(() => {
    writePersistedSetting(FONT_FAMILY_STORAGE_KEY, fontFamily)
  }, [fontFamily])

  const setTheme = useCallback((nextTheme: AppTheme) => {
    setThemeState(nextTheme)
  }, [])

  const setFontScalePercent = useCallback((nextPercent: number) => {
    setFontScalePercentState(clampFontScalePercent(nextPercent))
  }, [])

  const setFontFamily = useCallback((nextFamily: AppFontFamily) => {
    setFontFamilyState(nextFamily)
  }, [])

  const resetAccessibility = useCallback(() => {
    setThemeState(DEFAULT_THEME)
    setFontScalePercentState(DEFAULT_FONT_SCALE_PERCENT)
    setFontFamilyState(DEFAULT_FONT_FAMILY)
  }, [])

  const value = useMemo<AccessibilityContextValue>(
    () => ({
      theme,
      setTheme,
      fontScalePercent,
      setFontScalePercent,
      fontFamily,
      setFontFamily,
      resetAccessibility,
    }),
    [theme, setTheme, fontScalePercent, setFontScalePercent, fontFamily, setFontFamily, resetAccessibility],
  )

  return (
    <AccessibilityContext.Provider value={value}>
      {children}
    </AccessibilityContext.Provider>
  )
}
