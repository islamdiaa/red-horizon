// Build the relative-base web game into desktop/app (the files the Electron window loads) and copy the icon.
// Runs from desktop/ (npm run dev / build) or from the repository root (npm run desktop).
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(desktop, '..');
// Vite and the game's sources live in the main project (its own node_modules)
const { relativeBuild } = await import(pathToFileURL(path.join(repo, 'tools/release/relative-build.mjs')).href);
await relativeBuild(path.join(desktop, 'app'));
mkdirSync(path.join(desktop, 'build'), { recursive: true });
copyFileSync(path.join(repo, 'public/icons/icon-512.png'), path.join(desktop, 'build/icon.png'));
console.log('desktop/app ready');
