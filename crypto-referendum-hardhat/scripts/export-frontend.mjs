import { promises as fs } from 'node:fs';
import path from 'node:path';

async function main() {
  const root = path.resolve(process.cwd());
  const network = process.env.NETWORK || 'localhost';
  const src = path.join(root, 'deployments', network, 'CryptoReferendum.json');
  const dstDir = path.resolve(root, '..', 'crypto-referendum-frontend', 'public', 'deployments', network);
  const dst = path.join(dstDir, 'CryptoReferendum.json');

  try {
    const raw = await fs.readFile(src, 'utf-8');
    const full = JSON.parse(raw);
    const minimal = JSON.stringify({ address: full.address, abi: full.abi }, null, 2);
    await fs.mkdir(dstDir, { recursive: true });
    await fs.writeFile(dst, minimal);
    console.log(`[export-frontend] Wrote ${dst}`);
  } catch (e) {
    console.error('[export-frontend] Failed:', e);
    process.exitCode = 1;
  }
}

main();





