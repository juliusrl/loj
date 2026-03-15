import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { resolveReactDslViteHostConfig } from '@loj-lang/rdsl-host-react/vite';

const hostDir = fileURLToPath(new URL('.', import.meta.url));
const projectDir = path.resolve(hostDir, '..');
const repoRoot = path.resolve(projectDir, '..', '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, hostDir, '');
  const resolved = resolveReactDslViteHostConfig({
    hostDir,
    projectDir,
    repoRoot,
    env,
    defaultGeneratedDir: "../generated",
    defaultApiBase: "http://127.0.0.1:3001",
    defaultHost: "127.0.0.1",
    defaultPort: 5173,
    defaultPreviewPort: 4173,
  });

  return {
    plugins: [react()],
    ...resolved.viteConfig,
  };
});
