export const SPOTDL_INTEGRATION_STORAGE_KEY = 'spotdl-integration-enabled'
export const SPOTDL_INTEGRATION_EVENT = 'sample-solution:spotdl-integration-changed'
export const DOWNLOAD_TOOLS_UI_STORAGE_KEY = 'download-tools-ui-visible'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

const parseBooleanSetting = (value: string | null | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === null || value.trim() === '') return fallback
  return TRUTHY.has(value.trim().toLowerCase())
}

const ENV_SPOTIFY_IMPORT_ENABLED = parseBooleanSetting(
  import.meta.env.VITE_ENABLE_SPOTIFY_IMPORT as string | undefined,
  true,
)
const ENV_DOWNLOAD_TOOLS_UI_VISIBLE = parseBooleanSetting(
  import.meta.env.VITE_SHOW_DOWNLOAD_TOOLS_UI as string | undefined,
  false,
)

export const isSpotdlIntegrationEnabled = (): boolean => {
  if (typeof window === 'undefined') return ENV_SPOTIFY_IMPORT_ENABLED
  if (!ENV_SPOTIFY_IMPORT_ENABLED) return false
  return parseBooleanSetting(window.localStorage.getItem(SPOTDL_INTEGRATION_STORAGE_KEY), true)
}

export const setSpotdlIntegrationEnabled = (enabled: boolean) => {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(SPOTDL_INTEGRATION_STORAGE_KEY, String(enabled))
  window.dispatchEvent(
    new CustomEvent<boolean>(SPOTDL_INTEGRATION_EVENT, {
      detail: enabled,
    })
  )
}

export const isDownloadToolsUiVisible = (): boolean => {
  if (typeof window === 'undefined') return ENV_DOWNLOAD_TOOLS_UI_VISIBLE
  if (!ENV_DOWNLOAD_TOOLS_UI_VISIBLE) return false
  return parseBooleanSetting(window.localStorage.getItem(DOWNLOAD_TOOLS_UI_STORAGE_KEY), true)
}
