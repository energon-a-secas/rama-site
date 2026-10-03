/**
 * NeoKeys — script-tag entry.
 *
 * For sites that do not call init() from their own module graph:
 *
 *   <script type="module" src="js/neokeys/boot.js"></script>
 *
 * Every option then comes from meta tags (neo-chrome-toggle,
 * neo-fleet-source, neo-keys-store). A site that needs JS options, an
 * onKey hook or its own registrations imports index.js and calls init()
 * itself instead; init() is idempotent, so loading both is safe but
 * whichever runs first decides the options.
 */

import { init } from './index.js';

init();
