/* Boot. */
(function () {
  'use strict';
  const FS = window.FS;
  FS.store.load();
  const s = FS.store.get().settings;
  FS.audio.settings.music = s.music; FS.audio.settings.sfx = s.sfx; FS.audio.settings.vox = s.vox; FS.audio.settings.muted = s.muted;
  FS.ui.feltTexture();
  FS.ui.initTooltips();
  FS.tableView.init();
  FS.screens.init();
  // Any first interaction unlocks audio (browser autoplay rules)
  const unlock = () => { FS.audio.init(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  window.addEventListener('beforeunload', () => FS.store.save(true));
  FS.llm.harnessAvailable();
})();
