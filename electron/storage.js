import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const RENAME_RETRY_DELAYS = [25, 50, 100, 200, 400];
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

export function createAtomicWriter({ fileSystem = fs, platform = process.platform, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const pending = new Map();

  async function write(file, data) {
    await fileSystem.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fileSystem.writeFile(temporary, data, { mode: 0o600 });
      for (let attempt = 0; ; attempt += 1) {
        try { await fileSystem.rename(temporary, file); break; }
        catch (error) {
          if (platform !== 'win32' || !TRANSIENT_RENAME_CODES.has(error.code) || attempt >= RENAME_RETRY_DELAYS.length) throw error;
          // Windows readers/virus scanners can briefly hold the destination open.
          await wait(RENAME_RETRY_DELAYS[attempt]);
        }
      }
    } finally { await fileSystem.rm(temporary, { force: true }); }
  }

  return function atomicWrite(file, data) {
    const target = path.resolve(file);
    const key = platform === 'win32' ? target.toLowerCase() : target;
    // Queue before any I/O, so the last queued value wins even after a failed write.
    const operation = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(() => write(target, data));
    pending.set(key, operation);
    const release = () => { if (pending.get(key) === operation) pending.delete(key); };
    operation.then(release, release);
    return operation;
  };
}

export const atomicWrite = createAtomicWriter();

export async function readConfig(directory, fallback, normalize) {
  try { return normalize(JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8'))); }
  catch { return fallback(); }
}

export function createVault(directory, safeStorage) {
  const filename = path.join(directory, 'credentials.enc');
  let remembered = null;
  return {
    async exists() { try { await fs.access(filename); return true; } catch { return false; } },
    async read() {
      if (remembered) return { ...remembered };
      try {
        const encrypted = await fs.readFile(filename);
        if (!safeStorage.isEncryptionAvailable()) throw new Error('OS 보안 저장소를 열 수 없어요. 로그인 상태를 확인해 주세요.');
        const plaintext = safeStorage.decryptStringAsync
          ? (await safeStorage.decryptStringAsync(encrypted)).result
          : safeStorage.decryptString(encrypted);
        remembered = JSON.parse(plaintext);
        return { ...remembered };
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new Error('저장된 API 키를 열 수 없어요. 연결 설정에서 본인 키를 다시 저장해 주세요.');
      }
    },
    async save(input) {
      if (!input || typeof input.clientId !== 'string' || typeof input.clientSecret !== 'string') throw new Error('API 키를 입력해 주세요.');
      const clientId = input.clientId.trim(), clientSecret = input.clientSecret.trim();
      if (!clientId || !clientSecret || clientId.length > 4096 || clientSecret.length > 4096 || /[\r\n]/.test(clientId + clientSecret)) throw new Error('API 키의 형식을 확인해 주세요.');
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS 보안 저장소를 사용할 수 없어 키를 저장하지 않았어요.');
      const plain = JSON.stringify({clientId,clientSecret});
      const encrypted = safeStorage.encryptStringAsync ? await safeStorage.encryptStringAsync(plain) : safeStorage.encryptString(plain);
      await atomicWrite(filename, encrypted);
      remembered = {clientId,clientSecret};
    },
    async clear() { remembered = null; await fs.rm(filename, { force: true }); }
  };
}
