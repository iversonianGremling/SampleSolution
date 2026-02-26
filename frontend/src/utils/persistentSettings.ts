const safeGetLocalStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readPersistedSetting(key: string): string | null {
  const storage = safeGetLocalStorage()
  if (!storage) return null

  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

export function writePersistedSetting(key: string, value: string): void {
  const storage = safeGetLocalStorage()
  if (storage) {
    try {
      storage.setItem(key, value)
    } catch {
      // Ignore storage write errors (quota/private mode).
    }
  }

  if (typeof window !== 'undefined' && window.electron?.setSetting) {
    void window.electron.setSetting(key, value).catch(() => {
      // Ignore electron persistence failures; localStorage remains source of truth.
    })
  }
}

export function removePersistedSetting(key: string): void {
  const storage = safeGetLocalStorage()
  if (storage) {
    try {
      storage.removeItem(key)
    } catch {
      // Ignore storage delete errors.
    }
  }

  if (typeof window !== 'undefined' && window.electron?.removeSetting) {
    void window.electron.removeSetting(key).catch(() => {
      // Ignore electron persistence failures.
    })
  }
}

export async function hydratePersistedSettingFromElectron(key: string): Promise<string | null> {
  if (typeof window === 'undefined' || !window.electron?.getSetting) {
    return readPersistedSetting(key)
  }

  let electronValue: unknown = null
  try {
    electronValue = await window.electron.getSetting(key)
  } catch {
    return readPersistedSetting(key)
  }

  if (typeof electronValue !== 'string') {
    return readPersistedSetting(key)
  }

  const localValue = readPersistedSetting(key)
  if (localValue !== electronValue) {
    const storage = safeGetLocalStorage()
    if (storage) {
      try {
        storage.setItem(key, electronValue)
      } catch {
        // Ignore local write errors.
      }
    }
  }

  return electronValue
}
