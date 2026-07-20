/*
 * afk-track-autorenew.js — 魔物追蹤「自動續約」(2026-07-20 新增)
 *
 * 需求:魔物追蹤(奧貝勒／赫特／帝倫,js/11-world-map.js 的 renderObelNPC)持續 8 小時,
 *   到期後要重新走一次「開視窗→選地區→選怪物→開始追蹤」才能繼續,使用者要求加一顆
 *   「自動續約」開關,勾選後到期會自動用同樣的地區+怪物續約,不用每次手動重點。
 *
 * 做法:renderObelNPC 是核心檔案,不能直接改;用「monkeypatch 該渲染函式、跑完後在
 *   視窗裡補插入自訂 checkbox」這個專案既有的固定套路(倉庫全存/道具搜尋等外掛皆同手法),
 *   不改本體、同步不會被洗掉。續約本身**直接呼叫原作自己的 onObelMapChange/onObelMobToggle/
 *   obelStartTracking()**,不重寫任何扣錢/開始追蹤邏輯,行為與手動操作完全一致。
 *
 * 到期偵測:訂閱 afk-hook-bind.js 已經包好的 AFK_HOOK 'tick:after' 事件(不自己重新
 *   monkeypatch gameLoop),每次遊戲 tick 推進時檢查一次。
 *
 * 資料存放(皆為目前存檔位 currentSlot 專屬,換存檔位互不影響):
 *   - afk_track_autorenew_<slot>:'1'/'0',是否勾選自動續約
 *   - afk_track_last_<slot>:{map, mob} JSON,追蹤中/成功續約時即時記錄「最近一次追蹤目標」
 *
 * 金幣不足:不呼叫 obelStartTracking()(它金幣不足會跳出阻塞式 alert(),每次tick都觸發會狂跳),
 *   改成自己先檢查金幣,不夠只在系統日誌留一句提示(只提示一次,金幣足夠後會自動重試,不會因為
 *   失敗一次就永久關閉自動續約)。
 *
 * 優雅降級:找不到 renderObelNPC/onObelMapChange/onObelMobToggle/obelStartTracking 就安靜停用。
 */
(function () {
  'use strict';

  var TRACK_GOLD_COST = 100000;   // 與 js/11-world-map.js obelStartTracking() 內的 TRACKING_GOLD_COST 同步維護,原作調整此值要跟著改
  var CHECK_ROW_ID = 'afk-track-autorenew-row';

  function curSlot() { return (typeof currentSlot !== 'undefined' && currentSlot != null) ? currentSlot : 0; }
  function onKey() { return 'afk_track_autorenew_' + curSlot(); }
  function lastKey() { return 'afk_track_last_' + curSlot(); }

  function isAutoRenewOn() { try { return localStorage.getItem(onKey()) === '1'; } catch (e) { return false; } }
  function setAutoRenewOn(v) { try { localStorage.setItem(onKey(), v ? '1' : '0'); } catch (e) {} }

  function saveLastTarget(map, mob) { try { localStorage.setItem(lastKey(), JSON.stringify({ map: map, mob: mob })); } catch (e) {} }
  function loadLastTarget() { try { var raw = localStorage.getItem(lastKey()); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }

  var _goldWarned = false;

  function maybeAutoRenew() {
    try {
      if (typeof player === 'undefined' || !player || !player.cls) return;   // 未載入角色(空白預設)一律不動作
      var tr = player.tracking;
      if (tr && tr.until > Date.now()) { saveLastTarget(tr.map, tr.mob); return; }   // 追蹤中:隨時更新「最近目標」,供到期續約用
      if (!isAutoRenewOn()) return;
      var last = loadLastTarget();
      if (!last || !last.map || !last.mob) return;
      if (typeof DB === 'undefined' || !DB.maps || !DB.maps[last.map] || !DB.mobs || !DB.mobs[last.mob]) return;   // 地圖/怪物設定不存在(舊資料/同步後被移除)→安全放棄
      if ((player.gold || 0) < TRACK_GOLD_COST) {
        if (!_goldWarned) {
          _goldWarned = true;
          try { if (typeof logSys === 'function') logSys('⚠️ 自動續約魔物追蹤：金幣不足(需 ' + TRACK_GOLD_COST.toLocaleString() + '),已略過,金幣足夠時會自動重試。'); } catch (e) {}
        }
        return;
      }
      _goldWarned = false;
      if (typeof onObelMapChange !== 'function' || typeof onObelMobToggle !== 'function' || typeof obelStartTracking !== 'function') return;
      onObelMapChange(last.map);
      onObelMobToggle(last.mob);
      obelStartTracking();   // 沿用原作扣錢/寫入player.tracking/saveGame/logSys 全套邏輯
      try { if (typeof logSys === 'function') logSys('🔁 自動續約：已重新開始追蹤 <span class="text-amber-300 font-bold">' + ((DB.mobs[last.mob] || {}).n || last.mob) + '</span>。'); } catch (e) {}
    } catch (e) { console.warn('[AFK-track-autorenew] 自動續約檢查失敗:', e); }
  }

  function ensureCheckbox(div) {
    try {
      if (!div) return;
      var old = div.querySelector('#' + CHECK_ROW_ID);
      if (old) old.remove();   // renderObelNPC 每次都整段 innerHTML 覆蓋,舊節點理論上已被清掉,保險起見還是先移除避免重複
      var host = div.firstElementChild || div;
      var row = document.createElement('label');
      row.id = CHECK_ROW_ID;
      row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:0.85rem;color:#cbd5e1;cursor:pointer;padding:6px 2px;border-top:1px solid rgba(100,116,139,.35);margin-top:4px;';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.style.cssText = 'width:18px;height:18px;';   // 觸控目標夠大,手機也好點
      cb.checked = isAutoRenewOn();
      cb.addEventListener('change', function () {
        setAutoRenewOn(cb.checked);
        if (cb.checked && typeof player !== 'undefined' && player && player.tracking && player.tracking.until > Date.now()) {
          saveLastTarget(player.tracking.map, player.tracking.mob);   // 剛勾選就立刻補記目標,不用等下個tick
        }
      });
      var span = document.createElement('span');
      span.textContent = '自動續約(到期後自動用同樣目標花費金幣續約)';
      row.appendChild(cb);
      row.appendChild(span);
      host.appendChild(row);
    } catch (e) { console.warn('[AFK-track-autorenew] 插入checkbox失敗:', e); }
  }

  function wrapRender() {
    if (typeof window.renderObelNPC !== 'function' || window.renderObelNPC.__afkAutorenewWrapped) return typeof window.renderObelNPC === 'function';
    var orig = window.renderObelNPC;
    var wrapped = function (div) {
      var r = orig.apply(this, arguments);
      ensureCheckbox(div);
      return r;
    };
    wrapped.__afkAutorenewWrapped = true;
    window.renderObelNPC = wrapped;
    return true;
  }

  function init() {
    if (!wrapRender()) { console.warn('[AFK-track-autorenew] 找不到 renderObelNPC,外掛停用'); return; }
    if (window.AFK_HOOK && typeof window.AFK_HOOK.on === 'function') {
      window.AFK_HOOK.on('tick:after', maybeAutoRenew);
    } else {
      setInterval(maybeAutoRenew, 5000);   // 備援:理論上不會發生,afk-hook.js 排在所有外掛最前面
    }
    console.log('[AFK-track-autorenew] hooks OK');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
