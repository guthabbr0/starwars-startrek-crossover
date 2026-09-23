import { readFile, mkdir, writeFile } from 'node:fs/promises';
const textures = JSON.parse(await readFile(new URL('../assets/textures.json', import.meta.url), 'utf8'));
const destination = new URL('../public/textures/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const name of ['fleetHull', 'armadaHull', 'nebula', 'lava']) {
  if (typeof textures[name] !== 'string') throw new Error(`Missing texture: ${name}`);
  const bytes = Buffer.from(textures[name], 'base64');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error(`Invalid WebP container: ${name}`);
  await writeFile(new URL(`${name}.webp`, destination), bytes);
  console.log(`Prepared ${name}: ${bytes.length} bytes`);
}
