// Pre-load stealth patch for embedded Google Sign-In window (runs before page scripts)
try {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true
  });
} catch (_) {}

try {
  if (!window.chrome) {
    Object.defineProperty(window, 'chrome', {
      value: { runtime: {} },
      configurable: true
    });
  }
} catch (_) {}

try {
  const cleanBrands = [
    { brand: 'Chromium', version: '134' },
    { brand: 'Not:A-Brand', version: '24' },
    { brand: 'Google Chrome', version: '134' }
  ];
  const platformName = process.platform === 'darwin' ? 'macOS' : (process.platform === 'win32' ? 'Windows' : 'Linux');
  const fakeUaData = {
    brands: cleanBrands,
    mobile: false,
    platform: platformName,
    getHighEntropyValues: async () => ({
      brands: cleanBrands,
      mobile: false,
      platform: platformName,
      platformVersion: '15.0.0',
      architecture: 'x86',
      bitness: '64',
      model: '',
      uaFullVersion: '134.0.6998.89',
      fullVersionList: cleanBrands.map(b => ({ brand: b.brand, version: `${b.version}.0.6998.89` }))
    }),
    toJSON: () => ({
      brands: cleanBrands,
      mobile: false,
      platform: platformName
    })
  };
  Object.defineProperty(navigator, 'userAgentData', {
    get: () => fakeUaData,
    configurable: true
  });
} catch (_) {}

