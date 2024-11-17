const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const srcDir = path.join(__dirname, '../src/public');

console.log('Watching for file changes in public directory...');

// Run initial build
execSync('npm run build:html', { stdio: 'inherit' });

fs.watch(srcDir, { recursive: true }, (eventType, filename) => {
  if (filename) {
    console.log(`File ${filename} changed. Rebuilding...`);
    execSync('npm run build:html', { stdio: 'inherit' });
  }
}); 