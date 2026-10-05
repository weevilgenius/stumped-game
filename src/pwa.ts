/**
 * Registers the service worker that caches the built app for offline play.
 * Development skips this so the Vite server is not cached.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js');
  });
}
