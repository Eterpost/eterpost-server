import { randomBytes } from 'node:crypto';
import { access, constants, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AttachmentInfo } from './attachments';


const ID_PATTERN = /^[0-9a-f]{16}$/;

/**
 * Файлы вложений на диске: <dir>/<номер рассылки>/<id>. Имя файла
 * пользователя в путь не попадает — оно хранится в описании вложения
 */
export class AttachmentStore {
  public available = false;

  constructor (public readonly dir: string) {}

  /**
   * Создаёт каталог и проверяет, что в него можно писать
   */
  async init (): Promise<boolean> {
    try {
      await mkdir(this.dir, { recursive: true });
      await access(this.dir, constants.W_OK);
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async save (mailingId: number, content: Buffer): Promise<string> {
    const id = createId();
    const target = this.path(mailingId, id);
    await mkdir(this.mailingDir(mailingId), { recursive: true });
    // Через временный файл: недописанный файл не окажется под id
    await writeFile(target + '.tmp', content);
    await rename(target + '.tmp', target);
    return id;
  }

  path (mailingId: number, id: string): string {
    if (!ID_PATTERN.test(id)) {
      throw new Error(`Invalid attachment id: ${id}`);
    }
    return join(this.mailingDir(mailingId), id);
  }

  async exists (mailingId: number, id: string): Promise<boolean> {
    try {
      await access(this.path(mailingId, id), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Копирует файлы в каталог другой рассылки; описания — с новыми id
   */
  async copy (
    fromMailingId: number, toMailingId: number, attachments: AttachmentInfo[]
  ): Promise<AttachmentInfo[]> {
    await mkdir(this.mailingDir(toMailingId), { recursive: true });
    const result: AttachmentInfo[] = [];
    for (const attachment of attachments) {
      const id = createId();
      await copyFile(this.path(fromMailingId, attachment.id), this.path(toMailingId, id));
      result.push({ ...attachment, id });
    }
    return result;
  }

  async remove (mailingId: number, id: string): Promise<void> {
    await rm(this.path(mailingId, id), { force: true });
  }

  async removeAll (mailingId: number): Promise<void> {
    await rm(this.mailingDir(mailingId), { force: true, recursive: true });
  }

  private mailingDir (mailingId: number): string {
    if (!Number.isInteger(mailingId) || mailingId <= 0) {
      throw new Error(`Invalid mailing id: ${mailingId}`);
    }
    return join(this.dir, String(mailingId));
  }
}

function createId (): string {
  return randomBytes(8).toString('hex');
}
