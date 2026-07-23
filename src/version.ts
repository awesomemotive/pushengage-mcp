import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// package.json sits one level above this file in both layouts: src/ during
// development (tsx, jest) and dist/ in the published build.
export const PKG_VERSION: string = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
).version;
