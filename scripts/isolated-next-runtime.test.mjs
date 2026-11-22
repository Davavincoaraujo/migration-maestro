import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const project = resolve(process.env.MAESTRO_ISOLATED_PROJECT ?? '.local-maestro/isolated-next/c7c3cdbf306e688f7b80/project');
const req = createRequire(join(project, 'package.json'));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
test('installed real Next/React/TypeScript and native SWC load from isolated dependencies', async () => {
  for (const [name, version] of [['next','16.1.7'], ['react','19.2.3'], ['react-dom','19.2.3']]) {
    const path = req.resolve(name + '/package.json'); assert.ok(path.startsWith(project + '/node_modules/'));
    assert.equal((await json(path)).version, version);
  }
  assert.equal(typeof req('react').createElement, 'function');
  assert.equal(typeof req('react-dom/server').renderToStaticMarkup, 'function');
  assert.ok(req('@next/swc-darwin-arm64'));
});
test('TypeScript checks the actual isolated source without emitting files', async () => {
  await promisify(execFile)(process.execPath, [req.resolve('typescript/bin/tsc'), '--noEmit'], { cwd: project, timeout: 60000, maxBuffer: 512000 });
});
test('real Next production build prerenders root route and SEO metadata', async () => {
  const prerender = await json(join(project,'.next/prerender-manifest.json'));
  assert.ok(prerender.routes['/']);
  const html = await readFile(join(project,'.next/server/app/index.html'),'utf8');
  assert.match(html, /<main\b/); assert.match(html, /<h1[^>]*>Isolated Next.js runtime<\/h1>/);
  assert.match(html, /<html[^>]*lang="en"/); assert.match(html, /<title>Migration Maestro runtime validation<\/title>/);
  assert.match(html, /Migration implementation is pending Hermes/);
  const cssDir = join(project,'.next/static/css');
  const css = (await Promise.all((await readdir(cssDir)).filter(f=>f.endsWith('.css')).map(f=>readFile(join(cssDir,f),'utf8')))).join('\n');
  assert.match(css, /@media/);
  assert.ok((await readFile(join(project,'.next/BUILD_ID'),'utf8')).trim());
});
test('bootstrap provenance explicitly distinguishes coordinator code from Hermes migration', async () => {
  const provenance = await json(join(project,'../runtime-bootstrap-provenance.json'));
  assert.equal(provenance.hermesGenerated,false); assert.equal(provenance.migrationValidated,false);
  for(const [file,digest] of Object.entries(provenance.files)) assert.equal(createHash('sha256').update(await readFile(join(project,file))).digest('hex'),digest,file);
});
