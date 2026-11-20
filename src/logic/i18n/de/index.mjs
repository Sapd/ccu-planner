// Registers the German tables of the logic modules. Importing it is enough; the CLI and the MCP server never do.
import { addTranslations } from '../../i18n.mjs';
import * as describe from './describe.mjs';
import * as logic from './logic.mjs';

for (const table of [describe, logic]) addTranslations('de', table);
