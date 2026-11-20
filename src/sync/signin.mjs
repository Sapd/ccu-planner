// Shared with the native client; keep the regex portable to both engines.
import pattern from './signin-rule.json' with { type: 'json' };
const signin = new RegExp(pattern, 'i');
export const hasSigninForm = (html) => signin.test(html);
