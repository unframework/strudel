import { defineConfig } from 'vite';
import { resolve } from 'path';
import bundleAudioWorkletPlugin from 'vite-plugin-bundle-audioworklet';

export default defineConfig({
  plugins: [bundleAudioWorkletPlugin()],
  server: {
    fs: {
      allow: [resolve(__dirname, '../..')],
    },
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
  },
});
