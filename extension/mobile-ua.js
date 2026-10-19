// mobile-ua.js — ajetaan MAIN-maailmassa document_startissa jokaisella sivulla.
// Tekee jotain vain, jos background.js:n DNR-sääntö on lisännyt vastaukseen
// Server-Timing-merkinnän "aura-pocket", eli sivu on Pocket-ikkunassa mobiilitilassa.
(() => {
  let mobile = false;
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    mobile = !!nav?.serverTiming?.some(entry => entry.name === 'aura-pocket');
  } catch {}
  if (!mobile) return;

  const major = navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] || '130';
  const ua = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`;
  const proto = Navigator.prototype;
  const define = (prop, value) =>
    Object.defineProperty(proto, prop, { get: () => value, configurable: true, enumerable: true });

  define('userAgent', ua);
  define('appVersion', ua.slice('Mozilla/'.length));
  define('platform', 'Linux armv8l');
  define('maxTouchPoints', 5);

  const original = navigator.userAgentData;
  if (original) {
    const brands = original.brands;
    const low = { brands, mobile: true, platform: 'Android' };
    define('userAgentData', {
      ...low,
      getHighEntropyValues: async () => ({
        ...low,
        architecture: '',
        bitness: '',
        model: 'K',
        platformVersion: '10.0.0',
        uaFullVersion: `${major}.0.0.0`,
        fullVersionList: brands.map(b => ({ ...b, version: `${b.version}.0.0.0` })),
        wow64: false,
      }),
      toJSON: () => low,
    });
  }
})();
