import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: __dirname,
  // file:// 加载：资源必须相对路径，否则 loadFile 下 /assets/* 404。
  base: './',
  plugins: [react()],
  build: { outDir: '../renderer-dist', emptyOutDir: true },
})
