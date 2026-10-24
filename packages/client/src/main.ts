import './ui/styles.css';
import { App } from './App';

const app = new App();
// Dev-only handle for scripted browser smoke tests.
if (import.meta.env.DEV) (window as unknown as { __psst: App }).__psst = app;
