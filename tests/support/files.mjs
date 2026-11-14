import fs from 'node:fs/promises';
import path from 'node:path';
// Deliberately synthetic fixtures: basic signatures, never personal documents.
export const pdf = Buffer.from('%PDF-1.4\n% SYNTHETIC SHIPNOW TEST\n%%EOF\n');
export const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('SYNTHETIC PNG TEST')]);
export const jpeg = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.from('SYNTHETIC JPEG TEST'), Buffer.from([255, 217])]);
export async function files(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(root, e.name)) : [path.join(root, e.name)]))).flat();
}
