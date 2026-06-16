import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const ATTACHMENT_DIR = join(process.cwd(), "data", "attachments");

export async function storeAttachment(
  guildId: string,
  channelId: string,
  attachmentId: string,
  filename: string,
  data: Buffer | Uint8Array,
): Promise<void> {
  const dir = join(ATTACHMENT_DIR, guildId, channelId, attachmentId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), data);
}

export async function getAttachmentPath(
  guildId: string,
  channelId: string,
  attachmentId: string,
  filename: string,
): Promise<string> {
  return join(ATTACHMENT_DIR, guildId, channelId, attachmentId, filename);
}
