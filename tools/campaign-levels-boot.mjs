// Worker thread entry for tools/campaign-levels.ts: enable the tsx loader in this thread, then run the worker.
import { register } from 'tsx/esm/api';
register();
await import('./campaign-levels-worker.ts');
