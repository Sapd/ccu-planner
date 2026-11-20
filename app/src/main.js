import '@fontsource-variable/inter';
import './lib/ui/tokens.css';
import { mount } from 'svelte';
import './lib/i18n.svelte.js'; // sets the language before anything renders
import App from './App.svelte';

mount(App, { target: document.getElementById('app') });
