import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const workspacePackages = ['@ecommerce/shared', '@ecommerce/schemas']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    build: {
      outDir: 'out/main'
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          'account-login': resolve('src/preload/account-login.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    build: {
      outDir: resolve('out/renderer'),
      emptyOutDir: true
    }
  }
})
