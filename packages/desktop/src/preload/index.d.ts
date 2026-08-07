import type { DesktopApi } from '../shared/ipc.js';

declare global {
  interface Window {
    readonly desktop: DesktopApi;
  }
}

export {};
