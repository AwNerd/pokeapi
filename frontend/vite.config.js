import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The backend only allows CORS from this origin, so fail loudly instead of moving to another port.
  server: { port: 5173, strictPort: true },
})
