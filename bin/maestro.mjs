#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli=fileURLToPath(new URL('../src/cli-maestro-url.ts',import.meta.url));
const result=spawnSync(process.execPath,['--import','tsx',cli,...process.argv.slice(2)],{stdio:'inherit'});
process.exitCode=result.status??2;
