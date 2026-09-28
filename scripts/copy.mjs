import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist/extension', { recursive: true });
await mkdir('dist/server/public', { recursive: true });
for (const file of ['manifest.json', 'popup.html', 'popup.css']) {
  await cp(`src/extension/${file}`, `dist/extension/${file}`);
}
await cp('src/extension/icons', 'dist/extension/icons', { recursive: true });
for (const name of ['background', 'content', 'popup']) {
  const path = `dist/extension/${name}.js`;
  const source = await readFile(path, 'utf8');
  const script = source.replace(/\nexport \{\};\s*$/, '\n');
  if (/^\s*(import|export)\s/m.test(script)) throw new Error(`${path} must be a classic extension script`);
  await writeFile(path, script);
}
for (const file of ['feed.html', 'feed.css', 'feed.js', 'favicon.svg']) {
  await cp(`src/server/public/${file}`, `dist/server/public/${file}`);
}
await cp('src/server/db.py', 'dist/server/db.py');
