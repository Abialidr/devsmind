import * as fs from 'fs';
import * as path from 'path';

// Clean exports reading HTML templates from files to prevent syntax error collisions in TS files
export const VISUALIZER_2D_HTML = fs.readFileSync(path.join(__dirname, 'visualizer_2d.html'), 'utf8');
export const VISUALIZER_3D_HTML = fs.readFileSync(path.join(__dirname, 'visualizer_3d.html'), 'utf8');
