import { cpSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['src/lib/commerce/profile.ts', 'src/lib/commerce/seller.ts', 'src/lib/commerce/money.ts', 'src/lib/commerce/invoicePdf.ts', 'src/lib/server/invoices.ts', 'src/assets/NotoSans-Regular.ttf', 'src/assets/NotoSans-LICENSE.txt'];
const legal = readFileSync(resolve(root, 'embergames/src/lib/legal.ts'), 'utf8');
const company = /export const COMPANY = \{[\s\S]*?\} as const;/.exec(legal)?.[0];
if (!company || !readFileSync(resolve(root, 'embergames/src/lib/commerce/seller.ts'), 'utf8').includes(company)) throw new Error('Invoice seller differs from site legal identity.');
for (const file of files) {
  const source = resolve(root, 'embergames', file), target = resolve(root, 'embergames-admin', file);
  if (process.argv.includes('--check')) {
    if (!readFileSync(source).equals(readFileSync(target))) throw new Error(`Commerce mirror differs: ${file}`);
  } else cpSync(source, target);
}
console.log('Shared invoice and profile modules match.');
