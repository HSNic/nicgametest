// ⏱️ afk-offline-profiler.js — 離線結算效能日誌(2026-07-14 新增)
// 目的:替離線結算(afk-offline.js)加裝一套「碼表」,量測各階段耗時與擊殺/掉落/技能等統計,
//   純觀測、不影響任何遊戲數值/存檔格式。預設關閉(不印摘要),開 window.AFK_OFFLINE_DEBUG=true 才輸出。
// 掛點全部在 afk-offline.js 內呼叫本檔的 API,本檔自身不碰任何 DOM/全域遊戲函式。
(function () {
  'use strict';

  var DEBUG_KEY = 'AFK_OFFLINE_DEBUG';
  var LAST_REPORT_KEY = 'afk_offline_last_report';
  var LAST_BATCH_KEY = 'afk_offline_last_batch';
  function isDebug() { try { return !!window[DEBUG_KEY]; } catch (e) { return false; } }
  function round2(n) { return Math.round((n || 0) * 100) / 100; }
  function nowMs() { try { return performance.now(); } catch (e) { return Date.now(); } }

  var _report = null;      // 進行中的報告(begin()~finish() 之間非 null)
  var _lastReport = null;  // 最近一次結算完成的報告(供 getLastReport())
  var _sections = {};      // {名稱: {total:累計毫秒, activeSince:目前這段的起始時間或null}}
  var _beginTs = 0;

  // ⏱️ 批次結算(afk-batch-settle.js 依序切換8個存檔位)分組:每個存檔位各自呼叫一次 begin()/finish(),
  //   若只存「最近一筆」,批次跑完只會留下最後一格的資料、前面幾格全部被覆蓋消失,沒辦法診斷「哪一格特別慢」。
  //   beginBatch()~endBatch() 之間所有 finish() 產生的報告都會額外收進 _batchReports,批次結束後整批持久化。
  var _batchId = null;      // 目前是否在批次結算中(非 null 代表是,值為批次識別碼)
  var _batchReports = null; // 批次結算中已完成的各格報告陣列
  var _batchStartedAt = 0;

  function freshReport(offlineSeconds, character) {
    return {
      version: 1,
      startedAt: new Date().toISOString(),
      batchId: _batchId,   // 非批次結算時為 null
      // 🧑 補跑當下的角色資訊(由呼叫端在 begin() 時就傳入,不是診斷報告產生當下的全域 player/mapState——
      //   兩者可能是不同角色/不同地圖,尤其批次結算逐格切換、或使用者結算完後又切別的存檔位再去產生診斷報告時)
      character: {
        slot: (character && character.slot != null) ? character.slot : null,
        name: (character && character.name) || null,
        cls: (character && character.cls) || null,
        level: (character && character.level != null) ? character.level : null,
        map: (character && character.map) || null
      },
      offlineSeconds: Math.max(0, Math.round(offlineSeconds || 0)),
      timings: { fastModeMs: 0, bossMs: 0, lootMs: 0, batchMs: 0, uiMs: 0, fullSimMs: 0, gainItemMs: 0, saveGameMs: 0, totalMs: 0 },
      // 🚫 totalHits 2026-07-20 移除:這個欄位從沒有任何地方呼叫 increment('totalHits',...),
      //   要準確統計得改到原作攻擊判定核心(分散多處、不像技能/擊殺有單一函式可包),風險過高,不做半套留著誤導人。
      counts: { monsterKills: 0, bossKills: 0, dropCount: 0, skillCount: 0, buffCount: 0 },
      rewards: { exp: 0, gold: 0 },
      averages: { hitsPerKill: 0, dps: 0 },
      flags: { fastModeUsed: false, fallbackToFullSimulation: false, dpsAvailable: false },
      errors: []
    };
  }

  function beginBatch() {
    _batchId = 'batch-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
    _batchReports = [];
    _batchStartedAt = Date.now();
    return _batchId;
  }

  // extra(選填,afk-batch-settle.js 傳入):{ slotWallMs: {存檔位:各格總牆鐘毫秒}, totalWallMs: 整個批次總牆鐘毫秒 }。
  //   有 totalWallMs 才會算 batchOverheadMs = 整批總耗時 − 各格 report.timings.totalMs 加總,
  //   抓出「切格/loadGame/UI」這種不在任何單一report裡的批次額外耗時。
  function endBatch(extra) {
    if (_batchId == null) return null;
    var reports = _batchReports || [];
    var doc = { batchId: _batchId, startedAt: new Date(_batchStartedAt).toISOString(), finishedAt: new Date().toISOString(), reports: reports };
    if (extra && typeof extra === 'object') {
      for (var k in extra) { if (extra.hasOwnProperty(k)) doc[k] = extra[k]; }
      if (typeof extra.totalWallMs === 'number') {
        var sumMs = 0;
        for (var i = 0; i < reports.length; i++) sumMs += (reports[i].timings && reports[i].timings.totalMs) || 0;
        doc.batchOverheadMs = round2(extra.totalWallMs - sumMs);
      }
    }
    try { localStorage.setItem(LAST_BATCH_KEY, JSON.stringify(doc)); } catch (e) {}
    _lastBatchCache = doc;
    _batchId = null;
    _batchReports = null;
    return doc;
  }

  function begin(context) {
    // 每次補跑只建立一份報告:呼叫 begin() 一律視為「開始新的一次」,若上一份還沒 finish() 就直接捨棄(不應發生,補跑本就序列執行)
    _report = freshReport(context && context.offlineSeconds, context && context.character);
    _sections = {};
    _beginTs = nowMs();
  }

  function startSection(name) {
    if (!name) return;
    var s = _sections[name] || (_sections[name] = { total: 0, activeSince: null });
    if (s.activeSince != null) return;   // 重複 startSection 不覆蓋正在跑的計時
    s.activeSince = nowMs();
  }

  function endSection(name) {
    if (!name) return;
    var s = _sections[name];
    if (!s || s.activeSince == null) return;   // 找不到對應的 startSection → 安靜忽略,不中斷遊戲
    s.total += nowMs() - s.activeSince;
    s.activeSince = null;
  }

  function increment(name, amount) {
    if (!_report || !name) return;
    _report.counts[name] = (_report.counts[name] || 0) + (amount == null ? 1 : amount);
  }

  function addReward(type, amount) {
    if (!_report || !type) return;
    _report.rewards[type] = (_report.rewards[type] || 0) + (amount || 0);
  }

  function mark(flagName, value) {
    if (!_report || !flagName) return;
    _report.flags[flagName] = value;
  }

  function addError(error) {
    if (!_report) return;
    try { _report.errors.push(String((error && error.message) || error)); } catch (e) {}
  }

  function flushSections(report) {
    // finish() 前把還在跑的計時段強制收尾,避免漏算最後一段
    for (var k in _sections) {
      var s = _sections[k];
      if (s.activeSince != null) { s.total += nowMs() - s.activeSince; s.activeSince = null; }
    }
    report.timings.fastModeMs = round2(_sections.fastMode ? _sections.fastMode.total : 0);
    report.timings.bossMs     = round2(_sections.boss ? _sections.boss.total : 0);
    report.timings.lootMs     = round2(_sections.loot ? _sections.loot.total : 0);
    report.timings.batchMs    = round2(_sections.batch ? _sections.batch.total : 0);
    report.timings.uiMs       = round2(_sections.ui ? _sections.ui.total : 0);
    report.timings.fullSimMs  = round2(_sections.fullSim ? _sections.fullSim.total : 0);
    report.timings.gainItemMs = round2(_sections.gainItem ? _sections.gainItem.total : 0);
    report.timings.saveGameMs = round2(_sections.save ? _sections.save.total : 0);
  }

  function finish(context) {
    if (!_report) return null;
    var report = _report;
    flushSections(report);
    report.timings.totalMs = round2(nowMs() - _beginTs);
    if (context) {
      if (context.hitsPerKill != null) report.averages.hitsPerKill = round2(context.hitsPerKill);
      if (context.dps != null) { report.averages.dps = round2(context.dps); report.flags.dpsAvailable = true; }
      else { report.averages.dps = 0; }
    }
    _lastReport = report;
    try { localStorage.setItem(LAST_REPORT_KEY, JSON.stringify(report)); } catch (e) {}
    if (_batchId != null && report.batchId === _batchId && _batchReports) _batchReports.push(report);
    _report = null;
    _sections = {};
    printSummary(report);
    return report;
  }

  function printSummary(report) {
    report = report || _lastReport;
    if (!report || !isDebug()) return;
    try {
      console.groupCollapsed('[AFK-OFFLINE] 離線結算完成');
      console.log(
        '[AFK-OFFLINE] 離線結算完成\n' +
        '開始時間：' + report.startedAt + '\n' +
        '離線秒數：' + report.offlineSeconds + '\n\n' +
        'Fast Mode 花費：' + report.timings.fastModeMs + ' ms\n' +
        'Boss 花費：' + report.timings.bossMs + ' ms\n' +
        'Loot 花費：' + report.timings.lootMs + ' ms\n' +
        'Batch 花費：' + report.timings.batchMs + ' ms\n' +
        'UI 花費：' + report.timings.uiMs + ' ms\n' +
        '全模擬花費：' + report.timings.fullSimMs + ' ms（規格書未定義的補充欄位,供法師離線慢的專案分析用)\n' +
        'gainItem 花費：' + report.timings.gainItemMs + ' ms\n' +
        'saveGame 花費：' + report.timings.saveGameMs + ' ms\n' +
        '總耗時：' + report.timings.totalMs + ' ms\n\n' +
        '怪物數：' + report.counts.monsterKills + '\n' +
        'Boss數：' + report.counts.bossKills + '\n' +
        'Exp：' + report.rewards.exp + '\n' +
        'Gold：' + report.rewards.gold + '\n' +
        'Drop：' + report.counts.dropCount + '\n' +
        'Skill：' + report.counts.skillCount + '\n' +
        'Buff：' + report.counts.buffCount + '\n' +
        '平均拍數：' + report.averages.hitsPerKill.toFixed(2) + '\n' +
        '平均DPS：' + (report.flags.dpsAvailable ? report.averages.dps.toFixed(2) : 'N/A')
      );
      console.table(report.timings);
      console.table(report.counts);
      if (report.errors.length) console.warn('[AFK-OFFLINE] 本次結算過程中的例外：', report.errors);
      console.groupEnd();
    } catch (e) { console.warn('[AFK-OFFLINE] printSummary 失敗:', e); }
  }

  function getLastReport() {
    if (_lastReport) return _lastReport;
    try {
      var raw = localStorage.getItem(LAST_REPORT_KEY);
      if (raw) { _lastReport = JSON.parse(raw); return _lastReport; }
    } catch (e) {}
    return null;
  }

  var _lastBatchCache = null;
  function getLastBatch() {
    if (_lastBatchCache) return _lastBatchCache;
    try {
      var raw = localStorage.getItem(LAST_BATCH_KEY);
      if (raw) { _lastBatchCache = JSON.parse(raw); return _lastBatchCache; }
    } catch (e) {}
    return null;
  }

  window.AFKOfflineProfiler = {
    begin: begin,
    startSection: startSection,
    endSection: endSection,
    increment: increment,
    addReward: addReward,
    mark: mark,
    addError: addError,
    finish: finish,
    printSummary: printSummary,
    getLastReport: getLastReport,
    beginBatch: beginBatch,
    endBatch: endBatch,
    getLastBatch: getLastBatch
  };

  console.log('[AFK-offline-profiler] hooks OK — 離線結算效能日誌已就緒(預設關閉,開 window.AFK_OFFLINE_DEBUG=true 觀察)。');
})();
