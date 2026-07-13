/* ============================================================================
 * afk-quickpanel.js — 首頁「⚙ 設定」按鈕 + 彈窗:常用開關集中管理
 *
 *   原本首頁固定放兩顆常駐按鈕(✨戰鬥特效/🔢傷害數字),這裡改成只留一顆「⚙ 設定」
 *   按鈕(插在原本兩顆按鈕的位置),點開彈窗集中管理:
 *     戰鬥特效(呼叫原作既有 window.toggleVfxPref)
 *     傷害數字(呼叫原作既有 window.toggleVfxNumPref)
 *     音樂(呼叫原作既有 window.setBgmOn,js/17-audio.js)
 *     音效(呼叫原作既有 window.setSfxOn,js/17-audio.js)
 *     省電模式(本外掛新增,見下方說明)
 *     顯示怪物名稱(2026-07-13 從獨立設定項簡化搬入,呼叫 afk-mobname.js 暴露的
 *       window.AFK_MOBNAME;原本的「鎖定中常駐顯示」中間選項一併簡化拿掉,只剩開/關)
 *   原本兩顆常駐按鈕與說明文字改用 CSS 隱藏(不刪 DOM,原作邏輯/localStorage 偏好
 *   完全不受影響,只是換一種方式呈現),首頁不再被常駐按鈕佔位。
 *
 *   ⚠️「省電模式」老實說明:遊戲主迴圈的 tick 間隔(100ms)寫死在本體
 *   js/01-drops-config.js/js/03-combat-core.js,並非可調的「FPS」概念,外掛層
 *   無法在不動本體的情況下提供真正的 30/60 FPS 切換。這裡的「省電模式」改做
 *   「特效節流」的替代方案:開啟時關閉戰鬥特效+傷害數字(等同上面兩項開關都關),
 *   並額外關閉本外掛能控制的裝飾性 CSS 動畫/轉場(不影響戰鬥判定與版面本身),
 *   降低低效能裝置的耗電/發熱,但不是真的把遊戲畫面更新率降到 30 或 60。
 *
 *   只呼叫既有全域函式+讀寫獨立的 localStorage 偏好鍵,呼叫前皆用 typeof 防呆,
 *   找不到對應函式就整列開關隱藏(不強制顯示一個按下去沒反應的假開關)。
 *   有 DOM 掛點(#afk-qp-btn),列入 scripts/smoke-hooks.mjs。
 *
 * 掛接:在 index.html </body> 前加一行 <script src="afk-quickpanel.js?v=..."></script>
 * ========================================================================== */
(function () {
  'use strict';

  var POWERSAVE_KEY = 'afk_powersave_on';

  function isPowerSaveOn() {
    try { return localStorage.getItem(POWERSAVE_KEY) === '1'; } catch (e) { return false; }
  }
  function setPowerSave(on) {
    try { localStorage.setItem(POWERSAVE_KEY, on ? '1' : '0'); } catch (e) {}
    document.body.classList.toggle('afk-powersave', !!on);
    if (on) {
      // 一併關閉戰鬥特效與傷害數字,達到最大節流效果
      if (!window.__vfxOff && typeof window.toggleVfxPref === 'function') toggleVfxPref();
      if (!window.__vfxNumOff && typeof window.toggleVfxNumPref === 'function') toggleVfxNumPref();
    }
  }

  function injectCss() {
    if (document.getElementById('afk-qp-css')) return;
    var s = document.createElement('style');
    s.id = 'afk-qp-css';
    s.textContent = [
      // 隱藏原本兩顆常駐按鈕與下方說明文字(不刪 DOM,原作 localStorage 偏好/邏輯不受影響)
      '#btn-vfx-toggle,#btn-vfxnum-toggle{display:none !important;}',
      '#main-menu > p.text-xs{display:none !important;}',
      '#afk-qp-btn{background:linear-gradient(135deg,#334155 0%,#475569 50%,#334155 100%);border-color:#64748b;}',
      '#afk-qp-modal{display:none;position:fixed;inset:0;z-index:10000;background:rgba(2,6,23,.72);align-items:center;justify-content:center;padding:20px;}',
      '#afk-qp-modal.open{display:flex;}',
      '#afk-qp-card{width:min(380px,92vw);max-height:86vh;overflow:auto;background:#0f172a;border:1px solid #334155;border-radius:12px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);}',
      '#afk-qp-card h3{margin:0 0 14px;color:#facc15;font-size:18px;font-weight:800;text-align:center;}',
      '.afk-qp-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 4px;border-bottom:1px solid #1e293b;}',
      '.afk-qp-row:last-of-type{border-bottom:none;}',
      '.afk-qp-row-label{color:#e2e8f0;font-size:14.5px;line-height:1.4;}',
      '.afk-qp-row-sub{color:#94a3b8;font-size:12px;margin-top:2px;}',
      // 手機觸控友善的 checkbox 開關(比照專案既有慣例,不用純文字切換鈕)
      '.afk-qp-switch{position:relative;flex:0 0 auto;width:46px;height:26px;}',
      '.afk-qp-switch input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;}',
      '.afk-qp-switch .afk-qp-track{position:absolute;inset:0;border-radius:999px;background:#334155;transition:background .15s;pointer-events:none;}',
      '.afk-qp-switch .afk-qp-knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#cbd5e1;transition:transform .15s;pointer-events:none;}',
      '.afk-qp-switch input:checked ~ .afk-qp-track{background:#0e7490;}',
      '.afk-qp-switch input:checked ~ .afk-qp-knob{transform:translateX(20px);background:#a5f3fc;}',
      '#afk-qp-close{display:block;width:100%;margin-top:16px;padding:11px;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;font-family:inherit;border:1px solid #64748b;background:#334155;color:#e2e8f0;}',
      '#afk-qp-close:active{background:#1e293b;}',
      // 省電模式:暫停(不是關掉/歸零)無限循環的裝飾性 CSS keyframe 動畫(呼吸光暈/跑馬燈等),
      // 不動一次性的顯示/隱藏 transition(避免打斷依賴 transitionend 的邏輯);範圍給 body 全域,
      // 命中不到就無害(目前多數裝飾動畫已在別處被隱藏/移除,這裡是保底)。
      'body.afk-powersave *{animation-play-state:paused !important;}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  // 開關清單:每項自帶「目前是否開啟」的讀取、切換時要呼叫的函式、以及「這個開關可不可用」的防呆判斷
  function switchDefs() {
    return [
      {
        key: 'vfx', label: '✨ 戰鬥特效',
        sub: '戰鬥時的粒子/震動等視覺特效;效果較弱或卡頓的裝置可關閉',
        avail: function () { return typeof window.toggleVfxPref === 'function'; },
        get: function () { return !window.__vfxOff; },
        set: function () { toggleVfxPref(); }
      },
      {
        key: 'vfxnum', label: '🔢 傷害數字',
        sub: '戰鬥時飄動的傷害數字;可獨立關閉、不影響其餘特效',
        avail: function () { return typeof window.toggleVfxNumPref === 'function'; },
        get: function () { return !window.__vfxNumOff; },
        set: function () { toggleVfxNumPref(); }
      },
      {
        key: 'bgm', label: '🎵 音樂',
        avail: function () { return typeof window.setBgmOn === 'function' && typeof window._bgmCfg === 'object'; },
        get: function () { return !!(window._bgmCfg && _bgmCfg.on); },
        set: function (on) { setBgmOn(on); }
      },
      {
        key: 'sfx', label: '🔊 音效',
        avail: function () { return typeof window.setSfxOn === 'function' && typeof window._sfxCfg === 'object'; },
        get: function () { return !!(window._sfxCfg && _sfxCfg.on); },
        set: function (on) { setSfxOn(on); }
      },
      {
        key: 'powersave', label: '🔋 省電模式',
        sub: '關閉戰鬥特效/傷害數字並降低裝飾動畫,降低耗電發熱(並非真正調整遊戲更新率)',
        avail: function () { return true; },
        get: function () { return isPowerSaveOn(); },
        set: function (on) { setPowerSave(on); }
      },
      {
        key: 'mobname', label: '🏷️ 顯示怪物名稱',
        sub: '開啟後場上所有怪物的名字一直顯示,不用移游標;關閉則維持原版行為',
        avail: function () { return !!(window.AFK_MOBNAME && typeof window.AFK_MOBNAME.setOn === 'function'); },
        get: function () { return window.AFK_MOBNAME.isOn(); },
        set: function (on) { AFK_MOBNAME.setOn(on); }
      },
      {
        key: 'pet', label: '🐾 顯示寵物',
        sub: '關閉後隊伍面板不顯示出戰寵物卡片,冒險地圖也不顯示魔法娃娃飄浮寵物',
        avail: function () { return typeof window.showPet === 'function' && typeof window.hidePet === 'function'; },
        get: function () { return window.isPetVisible(); },
        set: function (on) { on ? showPet() : hidePet(); }
      },
      {
        key: 'summon', label: '🧚 顯示招喚獸',
        sub: '關閉後隊伍面板不顯示召喚物卡片',
        avail: function () { return typeof window.showSummon === 'function' && typeof window.hideSummon === 'function'; },
        get: function () { return window.isSummonVisible(); },
        set: function (on) { on ? showSummon() : hideSummon(); }
      }
    ];
  }

  var _rowInputs = [];   // { def, input }:供「切一個開關連動影響其他開關」時,即時刷新所有開關顯示

  function refreshAllRows() {
    _rowInputs.forEach(function (r) { r.input.checked = !!r.def.get(); });
  }

  function buildRow(def) {
    var row = document.createElement('div');
    row.className = 'afk-qp-row';
    var labelWrap = document.createElement('div');
    var label = document.createElement('div');
    label.className = 'afk-qp-row-label';
    label.textContent = def.label;
    labelWrap.appendChild(label);
    if (def.sub) {
      var sub = document.createElement('div');
      sub.className = 'afk-qp-row-sub';
      sub.textContent = def.sub;
      labelWrap.appendChild(sub);
    }
    var sw = document.createElement('label');
    sw.className = 'afk-qp-switch';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!def.get();
    // 有些開關會連動影響別的開關(例如省電模式會一併關掉戰鬥特效/傷害數字),
    // 切換後把全部開關重新讀一次目前實際狀態,畫面才不會停在切換前的舊狀態。
    input.addEventListener('change', function () { def.set(input.checked); refreshAllRows(); });
    var track = document.createElement('span'); track.className = 'afk-qp-track';
    var knob = document.createElement('span'); knob.className = 'afk-qp-knob';
    sw.appendChild(input); sw.appendChild(track); sw.appendChild(knob);
    row.appendChild(labelWrap);
    row.appendChild(sw);
    _rowInputs.push({ def: def, input: input });
    return row;
  }

  var modal = null, layer = null;
  function buildModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'afk-qp-modal';
    var card = document.createElement('div');
    card.id = 'afk-qp-card';
    var h3 = document.createElement('h3'); h3.textContent = '⚙ 設定';
    card.appendChild(h3);
    _rowInputs = [];
    switchDefs().forEach(function (def) {
      if (!def.avail()) return;   // 找不到對應函式(原作改版) → 這一列不顯示,不做假開關
      card.appendChild(buildRow(def));
    });
    var closeBtn = document.createElement('button');
    closeBtn.id = 'afk-qp-close'; closeBtn.type = 'button'; closeBtn.textContent = '關閉';
    closeBtn.addEventListener('click', requestClose);
    card.appendChild(closeBtn);
    modal.appendChild(card);
    modal.addEventListener('click', function (e) { if (e.target === modal) requestClose(); });
    document.body.appendChild(modal);
    return modal;
  }

  function requestClose() {
    if (layer && window.AFK_UI) AFK_UI.closeLayer(layer); else doClose();
  }
  function doClose() {
    if (modal) modal.classList.remove('open');
    layer = null;
  }
  function openPanel() {
    // 每次開啟都重建內容(反映最新狀態,5 顆開關很便宜、不特別做 diff)
    if (modal) { modal.remove(); modal = null; }
    buildModal();
    modal.classList.add('open');
    if (window.AFK_UI) layer = AFK_UI.openLayer(doClose);
  }

  function ensureButton() {
    if (document.getElementById('afk-qp-btn')) return;
    var menu = document.getElementById('main-menu');
    var startBtn = document.getElementById('btn-start-menu');
    if (!menu || !startBtn) return;
    var b = document.createElement('button');
    b.id = 'afk-qp-btn'; b.type = 'button';
    b.className = 'btn text-base w-72 py-2.5';
    b.textContent = '⚙ 設定';
    b.addEventListener('click', openPanel);
    startBtn.insertAdjacentElement('afterend', b);
  }

  function init() {
    injectCss();
    ensureButton();
    console.log('[AFK-quickpanel] hooks OK — 首頁設定彈窗已就緒。');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
