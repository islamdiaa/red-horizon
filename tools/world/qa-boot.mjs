// Worker thread entry for tools/world/qa-pool.ts: enable the tsx loader in this thread, then run the worker.
import { register } from 'tsx/esm/api';
register();
await import('./qa-worker.ts');
