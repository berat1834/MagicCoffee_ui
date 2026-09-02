import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.magiccoffee.kiosk',
  appName: 'MagicCoffee',
  webDir: 'dist',
  server: {
    url: 'https://magiccoffee-ui.onrender.com',
    cleartext: false,
  },
};

export default config;
