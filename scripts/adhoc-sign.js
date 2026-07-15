// electron-builder afterPack hook: ad-hoc sign the .app so Gatekeeper shows
// the "unverified developer" dialog (bypassable via right-click -> Open)
// instead of "damaged and can't be opened". No certificate required.
// Replace with real Developer ID signing + notarization when we have one.
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    stdio: 'inherit',
  });
};
