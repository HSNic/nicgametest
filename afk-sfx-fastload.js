/* ============================================================================
 * afk-sfx-fastload.js — 音效載入省流量:跳過「探測副檔名」浪費的 404 請求
 *
 *   本體 js/17-audio.js 的 _sfxTryLoad() 對每個音效固定依序試 mp3→ogg→wav,
 *   用 <audio src=...> 探測、失敗(404)才換下一個副檔名。但實測 assets/sfx/
 *   目前**完全沒有 mp3 檔**(全部是 ogg 或 wav),代表每一個音效第一次要播放時,
 *   至少都會先浪費一次 mp3 的 404 探測請求,其中 111 個(如武器揮擊音、
 *   受傷音等)實際是 wav,還會再多浪費一次 ogg 的 404。
 *
 *   解法:內建一份「檔名 → 實際副檔名」對照表(掃描目前 assets/sfx/ 目錄產生,
 *   453 筆),包住 _sfxTryLoad(),有對照就直接發正確格式的請求,不再依序探測;
 *   對照表沒有的檔名(原作者之後新增的音效)→ 呼叫原本的探測邏輯,行為不變、
 *   不會 404 也不會漏音效,只是少了這層加速。對照表命中但該檔案實際讀取失敗
 *   (例如原作者之後把某個音效檔的副檔名换了)→ 照樣退回原本探測邏輯,不會啞音。
 *
 *   只在 window._sfxTryLoad 存在時才包,缺函式就安靜停用,不影響遊戲。
 *   純包裝既有函式,不掛任何 DOM,不列入 scripts/smoke-hooks.mjs 的掛點冒煙檢查。
 *
 * 掛接:在 index.html </body> 前、js/17-audio.js 之後加一行
 *   <script src="afk-sfx-fastload.js?v=..."></script>
 * ========================================================================== */
(function () {
  'use strict';

  // 檔名(不含副檔名) → 實際存在的副檔名。由 assets/sfx/ 目錄實際內容產生(2026-07-13 量測)。
  var SFX_EXT_MAP = {"100":"ogg","101":"ogg","1010":"wav","1013":"wav","1018":"wav","102":"ogg","103":"ogg","1030":"wav","104":"wav","1041":"wav","1044":"wav","1047":"wav","105":"ogg","1050":"wav","1053":"wav","1059":"wav","106":"ogg","1064":"wav","1068":"wav","1077":"wav","108":"ogg","1080":"wav","1083":"wav","1086":"wav","109":"ogg","1096":"wav","1099":"wav","11":"wav","110":"ogg","111":"ogg","1127":"wav","113":"ogg","1132":"wav","114":"ogg","1148":"wav","115":"ogg","116":"ogg","1161":"wav","1169":"wav","117":"ogg","1180":"wav","119":"ogg","1191":"wav","1204":"wav","121":"ogg","1217":"ogg","1218":"ogg","1219":"ogg","122":"ogg","1220":"ogg","1221":"ogg","123":"ogg","1235":"wav","1240":"wav","1246":"wav","125":"ogg","126":"ogg","127":"ogg","1273":"wav","1278":"wav","128":"ogg","1285":"wav","13":"wav","130":"ogg","131":"ogg","132":"ogg","133":"ogg","136":"ogg","137":"ogg","1374":"wav","139":"ogg","1396":"wav","140":"ogg","1402":"wav","1406":"wav","141":"ogg","1411":"wav","1415":"wav","142":"ogg","1434":"wav","1437":"wav","144":"ogg","145":"ogg","147":"ogg","1482":"wav","1486":"wav","149":"ogg","150":"ogg","1513":"wav","1515":"wav","1517":"wav","1540":"wav","156":"ogg","157":"ogg","158":"wav","159":"ogg","1595":"ogg","1596":"ogg","1597":"ogg","1598":"ogg","1599":"ogg","160":"ogg","1600":"ogg","1601":"ogg","1602":"ogg","1603":"ogg","1604":"ogg","162":"ogg","163":"ogg","168":"ogg","173":"ogg","175":"ogg","176":"ogg","191":"ogg","195":"ogg","196":"ogg","197":"ogg","21":"ogg","212":"ogg","213":"ogg","214":"ogg","215":"ogg","216":"ogg","217":"ogg","219":"ogg","22":"ogg","223":"ogg","226":"ogg","23":"ogg","24":"ogg","244":"ogg","245":"ogg","246":"wav","248":"wav","249":"wav","25":"ogg","254":"ogg","255":"wav","256":"ogg","258":"ogg","26":"ogg","261":"ogg","262":"ogg","263":"wav","268":"wav","27":"ogg","274":"ogg","275":"wav","277":"ogg","278":"ogg","281":"ogg","282":"ogg","283":"ogg","287":"ogg","29":"ogg","290":"wav","291":"ogg","293":"ogg","295":"ogg","298":"ogg","299":"ogg","30":"ogg","301":"ogg","302":"ogg","34":"ogg","35":"ogg","3556":"ogg","3557":"ogg","3559":"ogg","3562":"ogg","3563":"ogg","3564":"ogg","3565":"ogg","3567":"ogg","3580":"ogg","3582":"ogg","3583":"ogg","3585":"ogg","36":"ogg","39":"ogg","40":"ogg","403":"wav","405":"ogg","407":"ogg","422":"wav","424":"ogg","427":"ogg","432":"ogg","433":"ogg","434":"wav","436":"ogg","438":"ogg","44":"ogg","441":"ogg","442":"ogg","445":"wav","45":"ogg","458":"ogg","460":"ogg","461":"wav","47":"ogg","4764":"ogg","4765":"ogg","4766":"ogg","4767":"ogg","48":"ogg","49":"ogg","491":"wav","4910":"ogg","4912":"ogg","4913":"ogg","4915":"ogg","4917":"ogg","4918":"ogg","4919":"ogg","4921":"ogg","4924":"ogg","4925":"ogg","4931":"ogg","4932":"ogg","4933":"ogg","4936":"ogg","4938":"ogg","4939":"ogg","494":"ogg","4944":"ogg","496":"ogg","4977":"ogg","4978":"ogg","499":"ogg","4995":"ogg","50":"ogg","501":"ogg","503":"wav","505":"ogg","506":"ogg","507":"ogg","509":"ogg","51":"ogg","513":"ogg","518":"ogg","519":"ogg","52":"ogg","522":"wav","530":"ogg","538":"wav","547":"ogg","548":"ogg","55":"ogg","551":"ogg","554":"ogg","557":"ogg","56":"ogg","560":"ogg","57":"ogg","571":"ogg","573":"ogg","574":"ogg","575":"ogg","58":"ogg","583":"ogg","586":"ogg","60":"ogg","600":"ogg","61":"ogg","610":"ogg","611":"ogg","614":"ogg","615":"ogg","616":"ogg","617":"ogg","618":"ogg","623":"ogg","625":"ogg","629":"ogg","63":"ogg","634":"ogg","635":"ogg","638":"ogg","639":"ogg","64":"ogg","640":"wav","642":"ogg","643":"ogg","646":"ogg","647":"ogg","650":"ogg","651":"ogg","653":"ogg","654":"ogg","658":"ogg","66":"wav","661":"ogg","663":"ogg","665":"wav","667":"ogg","669":"wav","67":"ogg","676":"ogg","6761":"wav","6779":"ogg","678":"ogg","6787":"ogg","68":"ogg","682":"ogg","690":"wav","692":"ogg","693":"ogg","696":"ogg","697":"ogg","698":"wav","70":"ogg","700":"ogg","704":"ogg","709":"ogg","71":"ogg","710":"ogg","712":"ogg","714":"ogg","715":"ogg","716":"ogg","717":"ogg","718":"ogg","719":"ogg","72":"ogg","720":"ogg","723":"ogg","724":"ogg","727":"ogg","73":"ogg","730":"ogg","732":"ogg","733":"ogg","735":"ogg","737":"ogg","740":"wav","746":"ogg","747":"ogg","748":"wav","75":"ogg","750":"ogg","751":"ogg","754":"ogg","755":"ogg","757":"ogg","76":"ogg","763":"wav","765":"ogg","767":"ogg","768":"wav","770":"ogg","772":"ogg","773":"wav","775":"ogg","777":"ogg","778":"wav","783":"wav","786":"wav","79":"ogg","790":"wav","793":"wav","799":"wav","80":"ogg","800":"ogg","801":"ogg","802":"ogg","803":"ogg","804":"ogg","805":"ogg","807":"ogg","808":"ogg","809":"ogg","81":"wav","813":"ogg","814":"ogg","815":"ogg","816":"ogg","819":"ogg","822":"ogg","823":"ogg","824":"ogg","825":"ogg","826":"ogg","828":"ogg","829":"ogg","83":"ogg","832":"ogg","833":"ogg","834":"ogg","835":"ogg","839":"ogg","84":"ogg","843":"ogg","845":"ogg","86":"wav","862":"wav","872":"wav","875":"wav","877":"wav","879":"wav","88":"ogg","881":"wav","883":"wav","885":"wav","887":"wav","889":"wav","89":"ogg","900":"wav","903":"wav","908":"wav","917":"wav","923":"wav","928":"wav","93":"ogg","94":"ogg","956":"wav","962":"wav","97":"ogg","974":"wav","977":"wav","980":"wav","983":"wav","988":"ogg","989":"wav","99":"ogg","993":"wav","attack_blunt1":"ogg","attack_blunt2":"ogg","attack_bow":"ogg","attack_chainsword":"ogg","attack_claw":"ogg","attack_dagger":"ogg","attack_dual":"ogg","attack_katana":"ogg","attack_qigu":"ogg","attack_spear":"ogg","attack_sword1":"ogg","attack_sword2":"ogg","attack_unarmed":"ogg","attack_wand":"ogg","attack_wpn_other":"ogg","attack_xbow":"ogg","crit":"ogg","hurt_elf_f":"ogg","hurt_elf_m":"ogg","hurt_knight_f":"ogg","hurt_knight_m":"ogg","hurt_mage_f":"ogg","hurt_mage_m":"ogg","hurt_royal_f":"ogg","hurt_royal_m":"ogg","levelup":"ogg","magic":"ogg"};

  if (typeof window._sfxTryLoad !== 'function') {
    console.warn('[AFK-sfxfast] 找不到 window._sfxTryLoad,可能原作者改了音效載入邏輯,已安靜停用(不影響音效播放,只是少了省流量效果)。');
    return;
  }

  var _origSfxTryLoad = window._sfxTryLoad;

  window._sfxTryLoad = function (key, def) {
    var ext = def && SFX_EXT_MAP[def.file];
    if (!ext) { _origSfxTryLoad(key, def); return; }   // 對照表沒有(新音效)→ 照舊探測,不影響行為

    var url = 'assets/sfx/' + def.file + '.' + ext;
    var probe = new Audio();
    probe.preload = 'auto';
    probe.addEventListener('canplaythrough', function () {
      if (window._sfxPool[key]) return;
      var arr = [probe];
      var n = (typeof window.SFX_POOL_N === 'number') ? window.SFX_POOL_N : 4;
      for (var j = 1; j < n; j++) { var a = new Audio(url); a.preload = 'auto'; arr.push(a); }
      window._sfxPool[key] = arr; window._sfxIdx[key] = 0;
    }, { once: true });
    // 對照表命中的副檔名意外讀取失敗(例如原作者換了檔案格式)→ 退回原本完整探測邏輯,不會啞音
    probe.addEventListener('error', function () { _origSfxTryLoad(key, def); }, { once: true });
    probe.src = url;
    try { probe.load(); } catch (e) {}
  };

  console.log('[AFK-sfxfast] hooks OK — 音效載入已改直接讀正確副檔名,減少無謂的 404 探測請求。');
})();
