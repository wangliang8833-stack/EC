import type { DesktopApi } from '@ecommerce/shared'

declare global {
  interface Window {
    desktopApi: DesktopApi
  }
}

export {}

