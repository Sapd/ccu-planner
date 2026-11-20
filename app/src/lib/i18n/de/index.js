// Registers every German table: the logic modules' and the app pages'.
import { addTranslations } from '../../../../../src/logic/i18n.mjs';
import '../../../../../src/logic/i18n/de/index.mjs';
import * as shell from './shell.js';
import * as todayGoals from './todayGoals.js';
import * as hangarStore from './hangarStore.js';

for (const table of [shell, todayGoals, hangarStore]) addTranslations('de', table);
