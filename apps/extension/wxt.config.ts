import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'Curio',
    description: 'Sparks curiosity while you read, without getting in the way.',
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting', 'alarms', 'offscreen'],
    // Needed to show the card on any page and read it on demand.
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Open Curio' },
    commands: {
      suggest: {
        suggested_key: { default: 'Alt+Shift+C' },
        description: 'Suggest something about this page',
      },
    },
  },
});
