import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { pwaIdentity } from "./pwa-identity";

const stationApi = process.env.VITE_PI_STATION_API ?? "http://127.0.0.1:8801";

export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    proxy: {
      "/v2": stationApi,
      "/shared": stationApi,
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: { globPatterns: ["**/*.{js,css,html,png,svg,ico}"] },
      manifest: {
        id: pwaIdentity.id,
        name: pwaIdentity.name,
        short_name: pwaIdentity.shortName,
        description: pwaIdentity.description,
        theme_color: "#f8faf7",
        background_color: "#f8faf7",
        display: "standalone",
        start_url: "/workspace",
        icons: [
          {
            src: "/icons/pi-station-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/pi-station-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/pi-station-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
