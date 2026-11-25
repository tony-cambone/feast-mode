import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Produces dist-single/index.html with all JS/CSS inlined, for opening from disk in a pinch.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: 'dist-single', emptyOutDir: true },
});
