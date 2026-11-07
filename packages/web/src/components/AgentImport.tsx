import { useEffect, useRef, useState } from 'react';
import type { AgentRegression } from '@sandbox-city/core';
import { answerFileText } from '../answer-file';
import { downloadJson } from './download';
import { AgentGuide } from './AgentGuide';

export function AgentImport({ selectedCase, onImport }: { selectedCase: AgentRegression; onImport: (text: string, caseId: string) => boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => setNotice(''), [selectedCase.id]);
  const inputName = `input-${selectedCase.id}.json`;
  const load = async (file?: File) => {
    if (!file) return;
    const caseId = selectedCase.id;
    try { const text = await answerFileText(file); setNotice(onImport(text, caseId) ? `${file.name} loaded. Check the answer below to create a saved result.` : 'The selected case changed while reading the file. Import the answer for the current case again.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'The file could not be read.'); }
    if (fileInput.current) fileInput.current.value = '';
  };
  return <section className="agent-import" aria-label="Bring your own agent">
    <p>Your agent runs on your machine. This page checks the answer it produced for the selected case.</p>
    <ol className="connect-steps"><li><b>Get the case</b><span>Give your agent this owner's request and seller listing.</span><button className="btn" onClick={() => downloadJson(inputName, selectedCase.input)}>Download agent input JSON</button></li><li><b>Run your agent locally</b><span>Use your existing adapter, or follow the setup guide.</span><details><summary>Command and answer format</summary><pre className="at-json">{`python3 path/to/my_agent.py < ${inputName} > answer.json`}</pre><p>Print one object: <code>{'{"buy":true,"qty":1,"ship_to":"address","reason":"explanation"}'}</code>, or <code>{'{"buy":false}'}</code>. Keep logs on stderr.</p></details><AgentGuide /></li><li><b>Bring back the answer</b><span>Import answer.json or paste it below. Then press Check pasted answer.</span><button className="btn" onClick={() => fileInput.current?.click()}>Import answer JSON</button><input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Agent answer JSON file" onChange={(e) => void load(e.currentTarget.files?.[0])} /></li></ol>
    <p className="import-notice" role="status">{notice || 'JSON answers only, up to 64 KiB. Files stay in this browser; importing does not execute code or judge the answer.'}</p>
  </section>;
}
