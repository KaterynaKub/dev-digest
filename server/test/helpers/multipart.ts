/**
 * Hand-rolled multipart/form-data body builder for `app.inject()` tests —
 * `@fastify/multipart` parses standard RFC 2388 bodies, and `app.inject`
 * doesn't have a built-in multipart helper, so tests that exercise
 * `POST /skills/import/preview` build the raw body + boundary themselves.
 */
export interface MultipartFile {
  fieldName: string;
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export function buildMultipartBody(files: MultipartFile[]): { body: Buffer; contentType: string } {
  const boundary = `----devdigest-test-${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];

  for (const file of files) {
    const contentBuf = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
    const header =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n` +
      `Content-Type: ${file.contentType ?? 'application/octet-stream'}\r\n\r\n`;
    parts.push(Buffer.from(header), contentBuf, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}
