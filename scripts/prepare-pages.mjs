import { copyFile } from 'node:fs/promises';

await copyFile('dist/index.html', 'dist/404.html');
if (process.env.VITE_INCLUDE_CNAME !== 'false') await copyFile('CNAME', 'dist/CNAME');
