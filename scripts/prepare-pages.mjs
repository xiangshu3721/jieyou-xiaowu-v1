import { copyFile } from 'node:fs/promises';

await copyFile('dist/index.html', 'dist/404.html');
await copyFile('CNAME', 'dist/CNAME');
