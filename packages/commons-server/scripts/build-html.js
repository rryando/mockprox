const fs = require('fs');
const path = require('path');

// Copy HTML files from src to dist
function copyHtmlFiles() {
  const srcPublicDir = path.join(__dirname, '../src/public');
  const distDirESM = path.join(__dirname, '../dist/esm/public');
  const distDirCJS = path.join(__dirname, '../dist/cjs/public');

  // Create destination directories if they don't exist
  [distDirESM, distDirCJS].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Copy all files from public directory
  function copyPublicFiles(srcDir, destDir) {
    const files = fs.readdirSync(srcDir);
    
    files.forEach(file => {
      const srcPath = path.join(srcDir, file);
      const destPath = path.join(destDir, file);
      const stat = fs.statSync(srcPath);
      
      if (stat.isDirectory()) {
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true });
        }
        copyPublicFiles(srcPath, destPath);
      } else {
        // Copy all files, not just HTML
        fs.copyFileSync(srcPath, destPath);
      }
    });
  }

  // Copy to both ESM and CJS directories
  [distDirESM, distDirCJS].forEach(destDir => {
    copyPublicFiles(srcPublicDir, destDir);
  });

  console.log('Public directory copied successfully');
}

copyHtmlFiles(); 