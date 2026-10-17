// Development only (node --import tsx): load the TypeScript worker through tsx inside the worker thread.
import { register } from 'tsx/esm/api';
register();
await import('./worker.ts');
