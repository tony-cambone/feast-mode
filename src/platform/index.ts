/**
 * PLATFORM PUBLIC API (contract). Owner: audio/platform agent. Signatures are fixed.
 * Every function must be safe to call when the API is missing (file://, old browser):
 * report 'unsupported' instead of throwing.
 */

export { notificationPermission, requestNotificationPermission, showNotification, closeNotification } from './notify';
export type { NotifPermission } from './notify';
export { createWakeLock } from './wakelock';
export type { WakeLockState, WakeLockController } from './wakelock';
export { createTicker } from './ticker';
export type { Ticker } from './ticker';
export { onResume, isFullscreen, toggleFullscreen } from './page';
