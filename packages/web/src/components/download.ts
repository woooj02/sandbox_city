export function downloadJson(name: string, value: unknown) {
  downloadText(name, JSON.stringify(value, null, 2), 'application/json');
}
export function downloadText(name: string, text: string, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
