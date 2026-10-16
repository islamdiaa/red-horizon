// Worker thread entry: enable the tsx loader in this thread, then run the TypeScript worker.
import { register } from 'tsx/esm/api';
register();
await import('./worker.ts');
