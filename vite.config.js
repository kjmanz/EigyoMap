import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const base = env.VITE_BASE_PATH || "/";
    const iconSrc = (file) => base === "/" ? `/${file}` : `${base.replace(/\/$/, "")}/${file}`;
    const startUrl = base === "/" ? "/" : base.endsWith("/") ? base : `${base}/`;
    return {
        base,
        plugins: [
            react(),
            VitePWA({
                registerType: "autoUpdate",
                includeAssets: ["favicon.svg"],
                manifest: {
                    name: "まちマップ",
                    short_name: "まちマップ",
                    description: "フィールド営業マップ CRM",
                    theme_color: "#2563eb",
                    background_color: "#ffffff",
                    display: "standalone",
                    start_url: startUrl,
                    icons: [
                        {
                            src: iconSrc("pwa-192.png"),
                            sizes: "192x192",
                            type: "image/png",
                        },
                        {
                            src: iconSrc("pwa-512.png"),
                            sizes: "512x512",
                            type: "image/png",
                        },
                    ],
                },
                workbox: {
                    globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
                    runtimeCaching: [
                        {
                            urlPattern: /^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/.+\/\d+\/\d+\/\d+\.(png|jpg)$/,
                            handler: "CacheFirst",
                            options: {
                                cacheName: "gsi-tiles",
                                expiration: {
                                    maxEntries: 200,
                                    maxAgeSeconds: 60 * 60 * 24 * 7,
                                },
                            },
                        },
                    ],
                },
            }),
        ],
        build: {
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (id.includes("leaflet"))
                            return "leaflet";
                        if (id.includes("@supabase"))
                            return "supabase";
                    },
                },
            },
        },
    };
});
