/** Trusted coordinator check: executes the generated server component with real React SSR.
 * CSS imports are ignored for semantic SSR; browser/visual checks remain separate.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";
const [projectArg, output] = process.argv.slice(2);
if (!projectArg) throw Error("PROJECT_REQUIRED");
const project = resolve(projectArg), req = createRequire(join(project, "package.json"));
const file = join(project, "src/app/page.tsx"), source = await readFile(file, "utf8");
assert.doesNotMatch(source, /use client|dangerouslySetInnerHTML|<script\b|<iframe\b|<form\b/);
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod: { exports: Record<string, unknown> } = { exports: {} };
const allowedRequire = (id: string) => {
  if (/^\.\/page\.module\.css$/.test(id)) return {};
  if (["react", "react/jsx-runtime"].includes(id)) return req(id);
  throw Error("SSR_IMPORT_OUTSIDE_PILOT_SCOPE");
};
const fn = runInNewContext(`(function(module,exports,require){${compiled}\n})`, {}, { filename: file, timeout: 5000 });
fn(mod, mod.exports, allowedRequire);
const React = req("react"), server = req("react-dom/server");
const html: string = server.renderToStaticMarkup(React.createElement(mod.exports.default));
assert.match(html, /<main\b/);
assert.match(html, /<h1\b[^>]*>Explore the imaginary garden<\/h1>/);
assert.match(html, /href="#garden"/); assert.match(html, /id="garden"/); assert.match(html, /Discover the garden/);
assert.doesNotMatch(html, /<script\b|<iframe\b|<form\b|https?:\/\//);
const css = await readFile(join(project, "src/app/page.module.css"), "utf8"); assert.match(css, /@media/);
if (output) await writeFile(output, html, { mode: 0o600 });
console.log(JSON.stringify({ check: "react-server-render", status: "passed", browserExecuted: false, htmlBytes: Buffer.byteLength(html) }));
