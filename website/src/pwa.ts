// @ts-ignore
import { registerSW } from 'virtual:pwa-register';

// Capture controller state before registerSW runs so we can distinguish
// the first-ever-visit claim from a real SW replacement on later visits.
const wasControlled = !!navigator.serviceWorker?.controller;

let swRegistration: ServiceWorkerRegistration | undefined;

registerSW({
  immediate: true,
  onRegisteredSW(_swScriptUrl, registration) {
    swRegistration = registration;
  },
});

// Force an SW update check when the tab regains focus. Mobile browsers
// (esp. iOS Safari) often skip the automatic update poll otherwise.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && swRegistration) {
    swRegistration.update().catch(() => {});
  }
});

let refreshing = false;
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (!wasControlled) return;
  if (refreshing) return;
  refreshing = true;
  window.location.reload();
});
