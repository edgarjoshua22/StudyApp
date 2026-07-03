// Set up global crash capture BEFORE any imports run (requires CommonJS)
if (global.ErrorUtils) {
  global.ErrorUtils.setGlobalHandler((error, isFatal) => {
    global.__CRASH_MSG__ = (error?.message || 'unknown') + '\n\n' + (error?.stack || '');
  });
}

const { registerRootComponent } = require('expo');
const { default: App } = require('./App');
registerRootComponent(App);
