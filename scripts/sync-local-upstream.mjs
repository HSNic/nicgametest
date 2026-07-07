import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const upstreamDir = process.argv[2];
if (!upstreamDir) {
  console.error('用法: node scripts/sync-local-upstream.mjs <原作者新版資料夾>');
  process.exit(1);
}
if (!existsSync(join(upstreamDir, 'index.html'))) {
  console.error('找不到新版 index.html: ' + upstreamDir);
  process.exit(1);
}

const currentIndex = readFileSync('index.html', 'utf8');
const upstreamIndex = readFileSync(join(upstreamDir, 'index.html'), 'utf8');
if (!upstreamIndex.includes('</body>')) throw new Error('新版 index.html 找不到 </body>');
if (/afk-[^"']+\.js/.test(upstreamIndex)) throw new Error('新版 index.html 已含 afk 外掛,中止避免重複掛載');

const pluginBlocks = [];
const lines = currentIndex.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  if (!/<script\s+src="afk-[^"?]+\.js(?:\?v=[^"]*)?"><\/script>/.test(lines[i])) continue;
  const prev = lines[i - 1] || '';
  if (/<!--/.test(prev) && /afk-|外掛|可獨立維護|PWA|Cloudflare|首頁|手機|小百科|掉落|修正|Service Worker/.test(prev)) {
    pluginBlocks.push(prev.trim() + '\n' + lines[i].trim());
  } else {
    pluginBlocks.push(lines[i].trim());
  }
}
if (!pluginBlocks.length) throw new Error('目前 index.html 找不到任何 afk 外掛 script,中止');

for (const dir of ['js', 'css', 'assets', 'public']) {
  const src = join(upstreamDir, dir);
  if (!existsSync(src)) continue;
  cpSync(src, dir, { recursive: true, force: true });
}

for (const file of ['manifest.webmanifest']) {
  const src = join(upstreamDir, file);
  if (existsSync(src)) cpSync(src, file, { force: true });
}

function sha1File(path) {
  return createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 10);
}

let merged = upstreamIndex;
const subresRe = /(?:src|href)="((?:js|css)\/[^"?]+\.(?:js|css))(?:\?[^"]*)?"/g;
const subres = [...new Set([...merged.matchAll(subresRe)].map((m) => m[1]))];
for (const path of subres) {
  if (!existsSync(path)) throw new Error('新版引用的子資源不存在: ' + path);
  const hash = sha1File(path);
  const esc = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  merged = merged.replace(new RegExp('"' + esc + '(?:\\?[^"]*)?"', 'g'), '"' + path + '?v=' + hash + '"');
}
merged = merged.replace('</body>', pluginBlocks.join('\n') + '\n</body>');
writeFileSync('index.html', merged);

function gitBlobSha(buf) {
  return createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'desktop.ini' || name === '.DS_Store') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const assetFiles = [
  ...walk('assets').filter((p) => !p.startsWith('assets/anim/')),
  ...walk('public/assets'),
].sort();
const assetsManifest = assetFiles.map((p) => ({ path: p, sha: gitBlobSha(readFileSync(p)), size: statSync(p).size }));
writeFileSync('assets-manifest.json', JSON.stringify(assetsManifest) + '\n');

const animDirs = existsSync('assets/anim')
  ? readdirSync('assets/anim')
      .map((name) => join('assets/anim', name))
      .filter((path) => statSync(path).isDirectory())
      .sort()
  : [];
const animManifest = animDirs.map((dir) => {
  const files = walk(dir).sort();
  const h = createHash('sha1');
  let size = 0;
  for (const file of files) {
    const buf = readFileSync(file);
    size += buf.length;
    h.update(relative(dir, file)).update('\0').update(buf);
  }
  return { dir, name: basename(dir), files: files.length, size, sha: h.digest('hex') };
});
writeFileSync('anim-manifest.json', JSON.stringify(animManifest) + '\n');

writeFileSync('last-sync.json', JSON.stringify({ syncedAt: new Date().toISOString(), source: basename(upstreamDir) }) + '\n');

console.log('[local-sync] upstream=' + upstreamDir);
console.log('[local-sync] plugins=' + pluginBlocks.length);
console.log('[local-sync] subresources=' + subres.length);
console.log('[local-sync] assets=' + assetsManifest.length);
console.log('[local-sync] anim=' + animManifest.length);
