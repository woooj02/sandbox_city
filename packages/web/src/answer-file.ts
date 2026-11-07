export const MAX_ANSWER_BYTES = 64 * 1024;
export async function answerFileText(file: Pick<File, 'size' | 'text'>) {
  if (file.size > MAX_ANSWER_BYTES) throw new Error('Choose an answer JSON file smaller than 64 KiB.');
  const text = await file.text();
  if (!text.trim()) throw new Error('That file is empty. Choose the JSON answer printed by your agent.');
  return text;
}
