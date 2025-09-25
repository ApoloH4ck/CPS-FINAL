import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  // ATTENZIONE: Sostituisci 'nombre-de-tu-repositorio' con il nome REALE del tuo repository GitHub
  base: '/CPS-FINAL/', 
  plugins: [react()],
})
