// ⏱️ afk-offline-profiler.js — 離線結算效能日誌(2026-07-14 新增)
// 目的:替離線結算(afk-offline.js)加裝一套「碼表」,量測各階段耗時與擊殺/掉落/技能等統計,
//   純觀測、不影響任何遊戲數值/存檔格式。預設關閉(不印摘要),開 window.AFK_OFFLINE_DEBUG=true 才輸出。
// 掛點全部在 afk-offline.js 內呼叫本檔的 API,本檔自身不碰任何 DOM/全域遊戲函式。
(function () {
  'use strict';

  var DEBUG_KEY = 'AFK_OFFLINE_DEBUG';
  function isDebug() { try { return !!window[DEBUG_KEY]; } catch (e) { return false; } }
  function round2(n) { return Math.round((n || 0) * 100) / 100; }
  function nowMs() { try { return performance.now(); } catch (e) { return Date.now(); } }

  var _report = null;      // 進行中的報告(begin()~finish() 之間非 null)
  var _lastReport = null;  // 最近一次結算完成的報告(供 getLastReport())
  var _sections = {};      // {名稱: {total:累計毫秒, activeSince:目前這段的起始時間或null}}
  var _beginTs = 0;

  function freshReport(offlineSeconds) {
    return {
      version: 1,
      startedAt: new Date().toISOString(),
      offlineSeconds: Math.max(0, Math.round(offlineSeconds || 0)),
      timings: { fastModeMs: 0, bossMs: 0, lootMs: 0, batchMs: 0, uiMs: 0, fullSimMs: 0, totalMs: 0 },
      counts: { monsterKills: 0, bossKills: 0, dropCount: 0, skillCount: 0, buffCount: 0, totalHits: 0 },
      rewards: { exp: 0, gold: 0 },
      averages: { hitsPerKill: 0, dps: 0 },
      flags: { fastModeUsed: false, fallbackToFullSimulation: false, dpsAvailable: false },
      errors: []
    };
  }

  function begin(context) {
    // 每次補跑只建立一份報告:呼叫 begin() 一律視為「開始新的一次」,若上一份還沒 finish() 就直接捨棄(不應發生,補跑本就序列執行)
    _report = freshReport(context && context.offlineSeconds);
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

  function getLastReport() { return _lastReport; }

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
    getLastReport: getLastReport
  };

  console.log('[AFK-offline-profiler] hooks OK — 離線結算效能日誌已就緒(預設關閉,開 window.AFK_OFFLINE_DEBUG=true 觀察)。');
})();
