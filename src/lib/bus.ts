// Stand-in for Tauri events outside the webview (browser dev and tests).
type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();

export const bus = {
  on(event: string, h: Handler): () => void {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(h);
    return () => handlers.get(event)?.delete(h);
  },
  emit(event: string, payload?: unknown) {
    handlers.get(event)?.forEach((h) => h(payload));
  },
  clear() {
    handlers.clear();
  },
};
