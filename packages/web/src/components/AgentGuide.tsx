import guide from '../../../../docs/AGENT_LAB_GUIDE.md?raw';
import { downloadText } from './download';
export function AgentGuide() {
  return <button className="simple-link" onClick={() => downloadText('sandbox-city-agent-guide.md', guide, 'text/markdown')}>Download agent setup guide</button>;
}
