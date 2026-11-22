import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

const jsBuild = await esbuild.build({
  entryPoints: [path.join(srcDir, 'main.jsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  jsx: 'automatic',
  target: ['es2020'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  loader: {
    '.css': 'empty',
  },
  write: false,
});

const cssSource = fs.readFileSync(path.join(srcDir, 'styles.css'), 'utf8');
const cssResult = await esbuild.transform(cssSource, {
  loader: 'css',
  minify: true,
});

const rawJs = jsBuild.outputFiles[0].text;
const safeJs = rawJs.replace(/<\/script/gi, '<\\/script');
const safeCss = cssResult.code.replace(/<\/style/gi, '<\\/style');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Simple Photo Cropper</title>
  <!--
    Self-contained offline distribution.
    Includes React v${pkgJson.dependencies.react} and ReactDOM v${pkgJson.dependencies['react-dom']} (MIT License).
  -->
  <style>${safeCss}</style>
</head>
<body>
  <div id="root"></div>
  <script>${safeJs}</script>
</body>
</html>
`;

// Verify zero external CDN scripts remain in shipped bundle
const forbiddenPatterns = ['unpkg.com', 'cdn.tailwindcss.com', '@babel/standalone', 'react.development.js'];
for (const pattern of forbiddenPatterns) {
  if (html.includes(pattern)) {
    throw new Error(`Build verification failed: forbidden CDN reference "${pattern}" found in index.html`);
  }
}

const outPath = path.join(rootDir, 'index.html');
fs.writeFileSync(outPath, html, 'utf8');
const stats = fs.statSync(outPath);
console.log(`Built self-contained ${outPath} (${(stats.size / 1024).toFixed(1)} KB)`);
