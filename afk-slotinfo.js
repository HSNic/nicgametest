/*
 * afk-slotinfo.js — 選角/載入畫面的「額外掛機資訊」掛載外掛(桌機 + 手機共用)
 *
 * 職責:在原作者 renderLoadSelect 渲染的視覺化選角卡片上「疊加」📍 目前掛在哪張地圖、⏱ 已掛機多久 資訊。
 *   只「附加」、絕不清空 → 原作者的卡片內容原封不動,桌機與手機共用同一份附加邏輯。
 *   對外仍暴露 window.AFK_SLOTINFO.read(slot) → { mapName, idleText }(純資料、無 DOM)供他人取用。
 *
 * 資料來源:afk-offline.js 寫的即時地圖記錄 afk_map_<slot>(較準)、最後活躍心跳 afk_ts_<slot>;
 *   讀不到 afk_map_ 就退回存檔 blob 的 ms.current。地圖中文名與離線上限呼叫 afk-offline 暴露的 window.__afk。
 *
 * 優雅降級:renderLoadSelect / __afk 不存在就安靜停用,不弄壞畫面。
 *
 * （2026-07-19 隨原作v3.6同步移除舊版文字清單選角畫面 #slot-select-panel，本檔同步拿掉對應的舊版附加邏輯）
 */
(function () {
  // 把離線毫秒數格式化成「X 天 Y 小時 / X 小時 Y 分 / X 分鐘 / 剛剛」
  function fmtIdle(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    if (s < 60) return '剛剛';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' 分鐘';
    var h = Math.floor(m / 60), rm = m % 60;
    if (h < 24) return rm ? (h + ' 小時 ' + rm + ' 分') : (h + ' 小時');
    var d = Math.floor(h / 24), rh = h % 24;
    return rh ? (d + ' 天 ' + rh + ' 小時') : (d + ' 天');
  }

  // 唯一資料源:給一個存檔位編號,回「掛機地圖中文名」與「已掛機多久」文字(沒有就回空字串)
  function read(slot) {
    // 存檔解析一次:優先用原作的 _lzGet(解壓 LZ1) + _saveUnwrap(去簽章),才讀得到壓縮存檔的 ms/p。
    var save = null;
    try {
      var _raw = (typeof _lzGet === 'function') ? _lzGet('lineage_idle_save_' + slot) : localStorage.getItem('lineage_idle_save_' + slot);
      if (_raw && typeof _saveUnwrap === 'function') _raw = _saveUnwrap(_raw).payload;
      if (_raw) save = JSON.parse(_raw);
    } catch (e) {}

    var mapId = '';
    try { mapId = localStorage.getItem('afk_map_' + slot) || ''; } catch (e) {}
    if (!mapId && save && save.ms) mapId = save.ms.current || '';
    var mapName = '';
    if (mapId) mapName = (window.__afk && typeof window.__afk.mapName === 'function') ? window.__afk.mapName(mapId) : mapId;

    var ts = 0; try { ts = +localStorage.getItem('afk_ts_' + slot) || 0; } catch (e) {}
    var idleText = '';
    if (ts > 0) {
      var idleMs = Date.now() - ts;
      var capH = (window.__afk && window.__afk.capHours) || 24;   // 離線收益上限(小時),讀 afk-offline
      idleText = '⏱ 已掛機 ' + fmtIdle(idleMs);
      if (idleMs >= capH * 3600000) idleText += '（收益上限 ' + capH + ' 小時）';   // 顯示真實時間,超過上限時提醒收益封頂
    }

    // 🔮 席琳世界狀態:存於 player.sherineWorld / player.sherineMad(兩者互斥),回 '' / 'world' / 'mad'
    var p = save && save.p;
    var sherine = p ? (p.sherineMad ? 'mad' : (p.sherineWorld ? 'world' : '')) : '';

    return { mapName: mapName, idleText: idleText, sherine: sherine };
  }

  window.AFK_SLOTINFO = { version: '1.0.0', read: read };

  // --- 新版(2026-07-11 三畫面改版):視覺化角色選擇畫面(#load-select-panel)的存檔卡片是純圖片
  //   按鈕(.load-slot-card,無文字列),改成在每張卡片左上角疊一個小徽章顯示 📍/⏱/🔮,
  //   純附加一個 absolute 定位的 span(卡片本身是 position:relative，見 css/style.css .load-slot-card),
  //   不動原本的 img/onclick/class，重繪(renderLoadSelect 每次都整個重建 grid)時舊徽章隨舊 DOM 一起被清掉、
  //   新徽章自然重新附加，不需要額外去重判斷。
  function appendLoadSlotInfo() {
    var grid = document.getElementById('load-slot-grid');
    if (!grid) return;
    var cards = grid.querySelectorAll('.load-slot-card[data-slot]');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (!card.classList.contains('filled')) continue;   // 空存檔位沒有掛機資訊可顯示
      var slot = parseInt(card.dataset.slot, 10);
      if (!slot) continue;
      var info = read(slot);
      if (!info.mapName && !info.idleText && !info.sherine) continue;
      var box = document.createElement('div');
      box.className = 'afk-slot-extra';
      box.style.cssText = 'position:absolute;left:0;right:0;bottom:2%;z-index:4;display:flex;flex-direction:column;align-items:center;gap:1px;font-size:.62rem;font-weight:700;color:#e2e8f0;text-shadow:0 1px 2px #000,0 0 3px #000;pointer-events:none;line-height:1.25;';
      if (info.sherine) {
        var s = document.createElement('span');
        s.textContent = info.sherine === 'mad' ? '🔥 瘋狂的席琳世界' : '🔮 席琳的世界';
        s.style.cssText = 'color:' + (info.sherine === 'mad' ? '#fb7185' : '#4ade80') + ';';
        box.appendChild(s);
      }
      if (info.mapName) { var a = document.createElement('span'); a.textContent = '📍 ' + info.mapName; box.appendChild(a); }
      if (info.idleText) { var b = document.createElement('span'); b.textContent = info.idleText; box.appendChild(b); }
      card.appendChild(box);
    }
  }
  function wrapRenderLoadSelect() {
    if (typeof window.renderLoadSelect !== 'function' || window.renderLoadSelect.__afkSlotInfo) return false;
    var orig = window.renderLoadSelect;
    var wrapped = function () { orig.apply(this, arguments); try { appendLoadSlotInfo(); } catch (e) {} };
    wrapped.__afkSlotInfo = true;
    window.renderLoadSelect = wrapped;
    return true;
  }

  var _newOk = wrapRenderLoadSelect();
  if (_newOk) {
    console.log('[AFK-slotinfo] hooks OK — 選角畫面附加掛機地點/已掛機時間(桌機 + 手機共用)。');
  } else {
    console.warn('[AFK-slotinfo] 找不到 renderLoadSelect，選角畫面掛機資訊停用。');
  }
})();
