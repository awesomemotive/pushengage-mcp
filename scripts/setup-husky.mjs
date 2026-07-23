#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: pkgRoot })
  .toString()
  .trim();
const hooksDir = relative(gitRoot, resolve(pkgRoot, '.husky'));
const huskyBin = resolve(pkgRoot, 'node_modules', 'husky', 'bin.js');

execFileSync('node', [huskyBin, hooksDir], { cwd: gitRoot, stdio: 'inherit' });
