import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import './lab.css';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';

// The interface and canvas labels use system fonts. Optional code fonts never block the page.
createRoot(document.getElementById('root')!).render(<App />);
