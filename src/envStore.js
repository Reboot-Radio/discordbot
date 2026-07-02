import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, '../.env');

export function getEnvBool(key, defaultValue = true) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }

  return value !== 'false' && value !== '0';
}

export async function setEnvPersist(key, value) {
  const serialized = String(value);
  process.env[key] = serialized;

  let contents = '';
  try {
    contents = await fs.readFile(ENV_PATH, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const lines = contents.length > 0 ? contents.split('\n') : [];
  const keyPrefix = `${key}=`;
  let replaced = false;

  const nextLines = lines.map((line) => {
    if (line.startsWith(keyPrefix) || line.startsWith(`# ${key}=`)) {
      replaced = true;
      return `${key}=${serialized}`;
    }

    return line;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== '') {
      nextLines.push('');
    }
    nextLines.push(`${key}=${serialized}`);
  }

  await fs.writeFile(ENV_PATH, `${nextLines.join('\n').replace(/\n?$/, '\n')}`, 'utf8');
}
