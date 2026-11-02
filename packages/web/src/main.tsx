import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';

async function boot() {
  // Pixi rasterises text once, so fonts must be ready before the city draws
  await Promise.all(['700 16px "Chakra Petch"', '16px "JetBrains Mono"', '700 16px "JetBrains Mono"'].map((f) => document.fonts.load(f, 'AZ09'))).catch(() => {});
  createRoot(document.getElementById('root')!).render(<App />);
}
boot();
