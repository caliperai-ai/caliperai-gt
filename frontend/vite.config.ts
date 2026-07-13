import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }): UserConfig => {
  const isProduction = mode === 'production';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
    build: {
      // Disable source maps in production to hide source code
      sourcemap: false,
      // Minification settings
      minify: isProduction ? 'terser' : 'esbuild',
      terserOptions: isProduction ? {
        compress: {
          // Allow console.* statements in production for debugging
          drop_console: false,
          drop_debugger: true,
          // Disabled to allow console logging
          // pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.warn'],
        },
        format: {
          // Remove comments in production
          comments: false,
        },
        mangle: {
          // Mangle property names for additional obfuscation (optional)
          // properties: { regex: /^_/ }, // Only mangle properties starting with _
        },
      } : undefined,
      // Chunk size warnings
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          // Obfuscate chunk names in production
          chunkFileNames: isProduction ? 'assets/[hash].js' : 'assets/[name]-[hash].js',
          entryFileNames: isProduction ? 'assets/[hash].js' : 'assets/[name]-[hash].js',
          assetFileNames: isProduction ? 'assets/[hash][extname]' : 'assets/[name]-[hash][extname]',
        },
      },
    },
    // Define environment variables available at build time
    define: {
      __DEV__: JSON.stringify(!isProduction),
      __PROD__: JSON.stringify(isProduction),
    },
  };
});
