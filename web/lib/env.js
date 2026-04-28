import path from 'node:path';
import dotenv from 'dotenv';

let loaded = false;

export function loadParentEnv() {
  if (loaded) return;
  loaded = true;
  const envPath = path.join(process.cwd(), '..', '.env');
  dotenv.config({ path: envPath });
}
