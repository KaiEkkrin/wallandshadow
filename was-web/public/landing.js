// Sets a CSS custom property based on hostname so the landing page background
// reflects which environment the visitor is on. Runs synchronously in <head>
// before body styles compute.
(function () {
  const hostname = window.location.hostname;
  let bgColor = '#282c34';

  if (hostname.startsWith('test.')) {
    bgColor = '#001f3e';
  } else if (hostname === 'localhost' || hostname === '127.0.0.1') {
    bgColor = '#062706';
  }

  document.documentElement.style.setProperty('--env-background', bgColor);
})();
