const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../src/mcp');
const distDir = path.join(__dirname, '../dist/mcp');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.copyFileSync(
  path.join(srcDir, 'visualizer_2d.html'),
  path.join(distDir, 'visualizer_2d.html')
);
console.log('✓ Copied visualizer_2d.html to dist/mcp/');

fs.copyFileSync(
  path.join(srcDir, 'visualizer_3d.html'),
  path.join(distDir, 'visualizer_3d.html')
);
console.log('✓ Copied visualizer_3d.html to dist/mcp/');
