export interface TrustedClickEvent {
  isTrusted: boolean
}

export function isTrustedTourClick(event: TrustedClickEvent): boolean {
  return event.isTrusted === true
}

export function handleTrustedTourAdvanceClick(
  event: TrustedClickEvent,
  onAdvance: () => void,
  onBeforeAdvance?: () => void,
): void {
  if (!isTrustedTourClick(event)) return
  onBeforeAdvance?.()
  onAdvance()
}
