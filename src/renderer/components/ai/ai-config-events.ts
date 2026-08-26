export const AI_CONFIG_CHANGED_EVENT = 'easyepi:ai-config-changed'

export function notifyAIConfigChanged(): void {
  window.dispatchEvent(new Event(AI_CONFIG_CHANGED_EVENT))
}

export function subscribeAIConfigChanged(listener: () => void): () => void {
  window.addEventListener(AI_CONFIG_CHANGED_EVENT, listener)
  return () => window.removeEventListener(AI_CONFIG_CHANGED_EVENT, listener)
}
