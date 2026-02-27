/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_WEB_API_BASE_URL?: string
  readonly VITE_DEV_API_BASE_URL?: string
  readonly VITE_DEV_PROXY_TARGET?: string
  readonly VITE_STRIPE_DONATION_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
