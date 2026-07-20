/*
 * afk-syslog-filter.js — 系統與物品日誌訊息分類開關(系統/掉落/收購)(2026-07-20 新增)
 *
 * 需求:戰鬥日誌已經有「敵人/玩家/傭兵/召喚/夥伴」訊息開關(js/01-drops-config.js 的
 *   _combatFilter),使用者要求系統與物品日誌(目前是同一塊面板 #syslog-panel,標題就叫
 *   「系統與物品日誌」,掉落/收購/一般系統訊息本來就混在一起)也比照做一組「系統/掉落/收購」開關。
 *
 * 做法(比照戰鬥日誌現成機制):
 *   - monkeypatch window.logSys(核心函式,不在 afk-hook 那 6 種涵蓋範圍內,個案評估後直接包一層):
 *     呼叫原函式產生 DOM 後,依訊息文字關鍵字分類,幫剛插入的 .log-entry 補上 data-log-cat 屬性。
 *   - 分類用關鍵字判斷(訊息含「掉落了」→掉落;含「收購」或「上架了」→收購;其餘→系統)。
 *     ⚠️ 這是關鍵字猜測,不是原作結構化的分類資料——如果原作以後改了訊息用詞,某幾則訊息可能
 *     被分類錯,但不影響遊戲運作,頂多顯示分類不準。
 *   - 用跟戰鬥日誌一樣的 CSS 手法:幫 #sys-log 容器加 sl-hide-<cat> class,靠 CSS 選擇器隱藏
 *     對應 [data-log-cat]的既有與未來訊息(不用重新渲染)。CSS 規則用外掛自己注入的 <style>,
 *     不改 css/style.css 本體。
 *   - 3 顆按鈕重用戰鬥日誌既有的 .cf-pill/.cf-off 樣式(css/style.css 已定義,純套用不新增核心CSS),
 *     插入在 #syslog-panel 的 .panel-header 正下方(獨立一行,不跟標題列擠在一起,手機也不會爆版面)。
 *
 * 存放:localStorage key lineage_idle_syslog_filter(全域,不分存檔位,比照 _combatFilter 的
 *   COMBAT_FILTER_KEY 精神——這是顯示偏好,不是遊戲資料)。
 *
 * 優雅降級:找不到 window.logSys 或 #syslog-panel/.panel-header 就安靜停用/不插入。
 */
(function () {
  'use strict';

  var FILTER_KEY = 'lineage_idle_syslog_filter';
  var CATS = [
    { key: 'sys',  label: '系統', color: '#e2e8f0', border: '#64748b', bg: 'rgba(71,85,105,.30)' },
    { key: 'drop', label: '掉落', color: '#6ee7b7', border: '#059669', bg: 'rgba(6,78,59,.30)' },
    { key: 'buy',  label: '收購', color: '#fcd34d', border: '#d97706', bg: 'rgba(120,53,15,.30)' }
  ];
  var filter = { sys: true, drop: true, buy: true };
  (function loadFilter() {
    try {
      var s = localStorage.getItem(FILTER_KEY);
      if (s) { var o = JSON.parse(s); for (var k in filter) if (typeof o[k] === 'boolean') filter[k] = o[k]; }
    } catch (e) {}
  })();
  function saveFilter() { try { localStorage.setItem(FILTER_KEY, JSON.stringify(filter)); } catch (e) {} }

  // 🔧 2026-07-20 修正:原本只認「掉落了」這個字眼,漏掉了最常見的一般掉落訊息——
  //   js/08-items-equip.js 的 gainItem 實際是組成「${怪名} 給你 ${物品名}。」(class="sys-item-gain"),
  //   只有極稀有/遺物掉落公告才會用「掉落了」這個字眼(js/04-combat-attack.js)。
  //   sys-item-gain 這個 class 名稱是原作自己標的「這是一筆物品獲得訊息」結構化標記,比關鍵字更準,
  //   涵蓋:怪物掉落給你/商店-製作-任務兌換的「獲得物品:」/掛機期間彙總的「掛機期間獲得：」。
  // 🔧 2026-07-20 再次修正(使用者回報):收購NPC「第一次上線廣播」那則訊息
  //   (js/24-pandora-relic-market.js `logSys(_broadcastLineHTML(w))`)實際文字是
  //   「收 ○○○ 金幣/鑽收 ○○○，人在 ○○○，意者密」,根本沒有「收購」兩個字,被誤判成系統分類。
  //   改用該函式輸出的結構化 class 名稱 wander-broadcast-name/wander-broadcast-text 判斷,
  //   跟 sys-item-gain 同一個精神(抓原作自己標的結構化標記,不是用猜的關鍵字)。
  function classify(msg) {
    if (typeof msg !== 'string') return 'sys';
    if (msg.indexOf('sys-item-gain') >= 0 || msg.indexOf('掉落了') >= 0) return 'drop';
    if (msg.indexOf('收購') >= 0 || msg.indexOf('上架了') >= 0 || msg.indexOf('wander-broadcast') >= 0) return 'buy';
    return 'sys';
  }

  function injectStyle() {
    if (document.getElementById('afk-syslog-filter-style')) return;
    var st = document.createElement('style');
    st.id = 'afk-syslog-filter-style';
    st.textContent = CATS.map(function (c) {
      return '#sys-log.sl-hide-' + c.key + ' [data-log-cat="' + c.key + '"]{display:none;}';
    }).join('');
    document.head.appendChild(st);
  }

  function applyFilter() {
    var el = document.getElementById('sys-log');
    if (el) CATS.forEach(function (c) { el.classList.toggle('sl-hide-' + c.key, !filter[c.key]); });
    CATS.forEach(function (c) {
      var btn = document.getElementById('sl-btn-' + c.key);
      if (btn) btn.classList.toggle('cf-off', !filter[c.key]);
    });
  }

  function toggle(key) {
    if (!(key in filter)) return;
    filter[key] = !filter[key];
    saveFilter();
    applyFilter();
  }

  function ensureFilterRow() {
    if (document.getElementById('afk-syslog-filter-row')) return;
    var panel = document.getElementById('syslog-panel');
    var header = panel && panel.querySelector('.panel-header');
    if (!panel || !header) return;
    var row = document.createElement('div');
    row.id = 'afk-syslog-filter-row';
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:4px 8px;border-bottom:1px solid rgba(30,58,138,.25);';
    CATS.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'sl-btn-' + c.key;
      btn.className = 'cf-pill' + (filter[c.key] ? '' : ' cf-off');
      btn.style.cssText = 'color:' + c.color + ';border-color:' + c.border + ';background:' + c.bg + ';';
      btn.title = '點亮/點暗：' + c.label + '訊息';
      btn.textContent = c.label;
      btn.addEventListener('click', function () { toggle(c.key); });
      row.appendChild(btn);
    });
    header.insertAdjacentElement('afterend', row);
  }

  function wrapLogSys() {
    if (typeof window.logSys !== 'function') return false;
    if (window.logSys.__afkSyslogFilterWrapped) return true;
    var orig = window.logSys;
    var wrapped = function (msg) {
      var r = orig.apply(this, arguments);
      try {
        var el = document.getElementById('sys-log');
        if (el && el.lastElementChild) el.lastElementChild.setAttribute('data-log-cat', classify(msg));
      } catch (e) {}
      return r;
    };
    wrapped.__afkSyslogFilterWrapped = true;
    window.logSys = wrapped;
    return true;
  }

  function init() {
    if (!wrapLogSys()) { console.warn('[AFK-syslog-filter] 找不到 logSys,外掛停用'); return; }
    injectStyle();
    ensureFilterRow();
    applyFilter();
    setInterval(ensureFilterRow, 2000);   // 保險:面板萬一被重建,按鈕列自動補回(目前觀察 #syslog-panel 不會重建,純防禦)
    console.log('[AFK-syslog-filter] hooks OK');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
