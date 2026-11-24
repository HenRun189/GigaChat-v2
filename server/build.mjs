import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  // Native / wasm packages stay external and are resolved from node_modules at runtime.
  external: ['sharp', 'pg', 'pg-native', '@electric-sql/pglite', 'web-push', 'bcryptjs', 'ws'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

cpSync('drizzle', 'dist/drizzle', { recursive: true });
console.log('server built -> dist/server.js');
