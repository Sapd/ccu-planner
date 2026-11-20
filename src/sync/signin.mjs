// Shared with the native client; keep the regexes portable to both engines.
import pattern from './signin-rule.json' with { type: 'json' };
import account from './account-rule.json' with { type: 'json' };
const signin = new RegExp(pattern, 'i');
const denied = new RegExp(account.denied, 'i');
const hangar = new RegExp(account.account, 'i');
export const hasSigninForm = (html) => signin.test(html);
// Signed out, RSI answers its account pages with 200 "Access denied" (with a CSRF token, no sign-in form).
export const isAccessDenied = (html) => denied.test(html);
// A positive sign of a signed-in account page: the hangar title or its pledge list.
export const isSignedInPage = (html) => !isAccessDenied(html) && !hasSigninForm(html) && hangar.test(html);
