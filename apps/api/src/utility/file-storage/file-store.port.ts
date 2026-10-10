export const FILE_STORE = Symbol('FileStore');

/** Port for byte storage. The prototype stores bytes in PostgreSQL; object storage can replace it later. */
export interface FileStore {
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
