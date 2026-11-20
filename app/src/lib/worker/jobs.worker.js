// Module worker for the slow jobs (see view/jobs.mjs for the protocol). Loads the same logic modules as the app.
import { createJobHost } from '../view/jobs.mjs';
import aliases from '../../../../src/logic/aliases.json';

const host = createJobHost({ post: (m) => self.postMessage(m), aliases });
self.onmessage = (e) => host.handle(e.data);
