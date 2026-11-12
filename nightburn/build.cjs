// Concatenates src/ into a single playable page.
//   node build.cjs [artifactOut]
// Writes index.html (standalone, open it on any phone or desktop browser) and,
// if a path is given, a body-only fragment for hosts that supply their own <html> skeleton.
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const libs = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/CopyShader.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/LuminosityHighPassShader.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/EffectComposer.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/ShaderPass.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/RenderPass.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/UnrealBloomPass.js',
].map(u => `<script src="${u}"></script>`).join('\n');
const debug = process.argv.includes('--debug');
const js = ['01-core.js', '02-audio.js', '03-world.js', '04-car.js', '05-game.js', '06-ui.js'].map(src).join('\n') + (debug ? '\n' + fs.readFileSync(path.join(__dirname, 'debug.js'), 'utf8') : '');
if (js.includes('</script')) throw new Error('script terminator inside source');
const rest = `${src('body.html')}\n${libs}\n<script>\n(function(){\n'use strict';\n${js}\n})();\n</script>\n`;
const page = src('head.html') + '\n' + rest;
const standalone = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="theme-color" content="#0a0718">\n<style>html,body{margin:0}[hidden]{display:none!important}</style>\n${src('head.html')}</head>\n<body>\n${rest}</body>\n</html>\n`;
const out = process.argv.slice(2).filter(a => !a.startsWith('--'))[0];
fs.writeFileSync(debug ? out : path.join(__dirname, 'index.html'), standalone);
if (out && !debug) fs.writeFileSync(out, page);
console.log('built', (standalone.length / 1024).toFixed(1) + ' KB');
