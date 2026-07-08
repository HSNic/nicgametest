/* ============================================================================
 * check-hook-points.mjs — 機械式關鍵字/識別碼比對(粗略自動掃描版)
 *
 * 用途:掃描所有 afk-*.js 外掛裡引用到的 DOM id / 全域函式名,
 *   確認這些字串在「同步進來的原作者最新程式碼」(index.html + js/*.js)裡還存在。
 *   即使冒煙測試(smoke-hooks.mjs)通過,原作者也可能改了外掛依賴的參數/行為而沒有立刻炸開
 *   ——這支腳本只做「字串還在不在」的機械比對,不做語意判斷,結果是給人工/AI 分析報告當素材,
 *   不是拿來自動決定要不要上線(見 CLAUDE.md「同步順序」規則)。
 *
 * 用法:node scripts/check-hook-points.mjs
 *   (在 sync-upstream.mjs 已把 index.html/js/*.js 覆蓋成上游最新版之後執行)
 *   exit 0 → 全部字串都還在;exit 1 → 有字串消失,印出清單。
 * ========================================================================== */
import { readFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';

function setOutput(k, v) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  console.log(`[out] ${k}=${v}`);
}

// 1. 找出所有外掛檔
const pluginFiles = readdirSync('.').filter((f) => /^afk-.*\.js$/.test(f));

// 2. 從外掛程式碼裡粗略掃出「依賴原作者的 DOM id / 選擇器字串」
//    只抓 getElementById('...') 與 querySelector(All)('#...' 或純字母數字-底線的簡單選擇器)。
//    不追求 100% 精準(變數拼字串的抓不到),先求有、之後踩到漏抓的案例再補。
const ID_RE = /\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
const QS_RE = /\.querySelector(?:All)?\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)/g;

// 外掛自己「建立」的 DOM id(自己 innerHTML/insertAdjacentHTML 塞進去的 id="..."),
// 這些不是依賴原作者、要先排除,否則會整批誤判成「消失」。
const OWN_ID_RE = /\bid\s*=\s*['"\\`]?([A-Za-z0-9_-]+)/g;

const domIds = new Set();
const ownIds = new Set();
for (const file of pluginFiles) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(ID_RE)) domIds.add(m[1]);
  for (const m of src.matchAll(QS_RE)) domIds.add(m[1]);
  for (const m of src.matchAll(OWN_ID_RE)) ownIds.add(m[1]);
}
for (const id of ownIds) domIds.delete(id);

// 3. 已知的原作者全域函式/變數名(手動列一份粗清單;CLAUDE.md 裡反覆提到的核心全域)。
//    先求有:漏列的等踩到案例再補進來,不追求一次列完整。
const KNOWN_GLOBALS = [
  'DB', 'player', 'state', 'saveGame', 'loadGame', 'tick', 'gainItem',
  'MAP_CATEGORIES', 'MAP_REGIONS', 'equipOk', 'buildItemDescHTML',
  'CRAFT_RECIPES', 'SHOP_LISTS',
];

// 外掛自己定義的同名函式/變數(function NAME(... / var|let|const NAME =),排除掉——
// 這種是外掛內部的 local helper,不是依賴原作者的全域(homeTown/gotoMap 踩過:
// 外掛自己包了一份同名函式,跟原作者全域無關)。
const OWN_DEF_RE = (name) => new RegExp(
  '\\bfunction\\s+' + name + '\\s*\\(|\\b(?:var|let|const)\\s+' + name + '\\b'
);

const usedGlobals = new Set();
for (const file of pluginFiles) {
  const src = readFileSync(file, 'utf8');
  for (const name of KNOWN_GLOBALS) {
    if (OWN_DEF_RE(name).test(src)) continue;   // 外掛自己定義的同名東西,跳過
    if (new RegExp('\\b' + name + '\\b').test(src)) usedGlobals.add(name);
  }
}

// 4. 讀「同步進來的上游最新程式碼」(index.html + js/*.js),當作比對的字串池
let pool = existsSync('index.html') ? readFileSync('index.html', 'utf8') : '';
if (existsSync('js')) {
  for (const f of readdirSync('js').filter((f) => f.endsWith('.js'))) {
    pool += '\n' + readFileSync('js/' + f, 'utf8');
  }
}

// 5. 逐一比對,列出消失的字串
const missingIds = [...domIds].filter((id) => !pool.includes(id));
const missingGlobals = [...usedGlobals].filter((name) => !new RegExp('\\b' + name + '\\b').test(pool));

const ok = missingIds.length === 0 && missingGlobals.length === 0;
console.log(`關鍵字/識別碼比對:掛點 DOM id 共 ${domIds.size} 個、全域引用共 ${usedGlobals.size} 個。`);
if (missingIds.length) console.log('⚠️ 消失/改名的 DOM id:\n  ' + missingIds.join('\n  '));
if (missingGlobals.length) console.log('⚠️ 消失/改名的全域函式/變數:\n  ' + missingGlobals.join('\n  '));
if (ok) console.log('全部外掛依賴的 DOM id / 全域引用,在上游最新程式碼裡都還找得到字串。');

setOutput('hook_points_ok', ok ? 'true' : 'false');
setOutput('missing_ids', missingIds.join(','));
setOutput('missing_globals', missingGlobals.join(','));

if (!ok) process.exit(1);
