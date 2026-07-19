/* ============================================================================
 * afk-cache.js — 素材對帳邏輯(階段3,從 afk-pwa.js 拆出,純職責分離)
 *
 * ⚠️ 這次只做「拆檔案」,不做「分層預抓」:
 *   交接文件原本規劃階段3要把 assets-manifest.json 擴充分層(core/common/boss),
 *   讓安裝後只預抓核心層、縮短「首次可玩時間」——但目前 afk-pwa.js 早就已經完全
 *   移除背景預抓了(2026-07 因 GitHub Pages 100GB/月流量軟上限而拿掉,改純
 *   on-demand),重新加回分層預抓等於推翻那個決定,需要另外評估流量代價、不能
 *   跟這次拆檔案一起做。這裡維持現行行為 100% 不變,只是把邏輯搬到獨立檔案。
 *
 * 職責:
 *   - reconcileImages():每次載入把最新 assets-manifest.json 送進 SW,
 *     只清掉 sha 對不上的舊圖(作者換一張只清那一張),不下載整包。
 *   - reconcileAnim():同上,但針對怪物動畫幀(逐「怪」對帳,anim-manifest.json)。
 *   - 都不下載圖、幾乎不耗流量,只確保圖桶不繼續餵舊圖。
 *
 * 依賴:navigator.serviceWorker(呼叫方要自行確認 pwaCapable,本檔不重複判斷)。
 * 掛接:index.html </body> 前,需排在 afk-pwa.js 之前(afk-pwa.js 呼叫 AFK_CACHE)。
 * ========================================================================== */
(function () {
  'use strict';

  // 抓最新對帳清單(走網路、永遠最新),交給 cb 用。
  function withJson(url, cb) {
    fetch(url, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data && data.length) cb(data); })
      .catch(function () {});
  }
  // 首次安裝尚未接管(無 controller)→ 等接管後再把 fn 跑起來。
  function whenController(fn) {
    var ctrl = navigator.serviceWorker.controller;
    if (ctrl) { fn(ctrl); return; }
    navigator.serviceWorker.addEventListener('controllerchange', function once() {
      navigator.serviceWorker.removeEventListener('controllerchange', once);
      whenController(fn);
    });
  }
  // 每次載入把最新 assets-manifest 送給 SW reconcile:只清掉 sha 對不上的舊圖(作者換一張只清那一張,
  //   下次用到才 on-demand 抓新版),不下載整包。
  function reconcileImages() {
    whenController(function (ctrl) {
      withJson('assets-manifest.json', function (manifest) {
        ctrl.postMessage({ type: 'reconcile-images', manifest: manifest });
      });
    });
  }
  // 怪物動畫幀「一怪一雜湊」對帳:anim/ 幀太多不進 assets-manifest,改用 anim-manifest.json(每個怪資料夾一個合併 sha),
  //   送給 SW 逐「怪」比對——某怪的幀被作者換過 → 該怪快取整包清掉、下次看到時 on-demand 抓新版。不下載整包。
  function reconcileAnim() {
    whenController(function (ctrl) {
      withJson('anim-manifest.json', function (folders) {
        ctrl.postMessage({ type: 'reconcile-anim', folders: folders });
      });
    });
  }

  window.AFK_CACHE = { reconcileImages: reconcileImages, reconcileAnim: reconcileAnim };
  console.log('[AFK-cache] hooks OK — 圖桶/動畫幀逐張對帳已就緒(不預抓,圖片用到才抓)。');
})();
