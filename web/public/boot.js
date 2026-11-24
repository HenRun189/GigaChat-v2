// Runs before the app bundle: applies the stored colour mode and theme so there is no flash.
(function () {
  try {
    var m = localStorage.getItem('gc-mode');
    var dark = m === 'dark' || (m !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.mode = dark ? 'dark' : 'light';
    var t = localStorage.getItem('gc-theme');
    if (t) document.documentElement.dataset.theme = t;
  } catch (e) {
    /* storage unavailable */
  }
})();
