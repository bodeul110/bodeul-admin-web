import { defineConfig, loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const publicEnv = (nextName: string, legacyName: string, fallback = '') =>
    env[nextName]?.trim() || env[legacyName]?.trim() || fallback

  return {
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
      'process.env.NEXT_PUBLIC_FIREBASE_API_KEY': JSON.stringify(publicEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'VITE_FIREBASE_API_KEY')),
      'process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN': JSON.stringify(publicEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_AUTH_DOMAIN')),
      'process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID': JSON.stringify(publicEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_PROJECT_ID')),
      'process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET': JSON.stringify(publicEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_STORAGE_BUCKET')),
      'process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(publicEnv('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_MESSAGING_SENDER_ID')),
      'process.env.NEXT_PUBLIC_FIREBASE_APP_ID': JSON.stringify(publicEnv('NEXT_PUBLIC_FIREBASE_APP_ID', 'VITE_FIREBASE_APP_ID')),
      'process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY': JSON.stringify(publicEnv('NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY', 'VITE_FIREBASE_APPCHECK_SITE_KEY')),
      'process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN': JSON.stringify(publicEnv('NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN', 'VITE_FIREBASE_APPCHECK_DEBUG_TOKEN')),
      'process.env.NEXT_PUBLIC_BODEUL_DATA_BACKEND': JSON.stringify(publicEnv('NEXT_PUBLIC_BODEUL_DATA_BACKEND', 'VITE_BODEUL_DATA_BACKEND', 'firebase')),
      'process.env.NEXT_PUBLIC_BODEUL_API_BASE_URL': JSON.stringify(publicEnv('NEXT_PUBLIC_BODEUL_API_BASE_URL', 'VITE_BODEUL_API_BASE_URL')),
    },
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/firebase')) {
              return 'firebase-vendor'
            }
            if (
              id.includes('node_modules/react')
              || id.includes('node_modules/react-dom')
              || id.includes('node_modules/scheduler')
            ) {
              return 'react-vendor'
            }
            return undefined
          }
        },
      },
    },
  }
})
