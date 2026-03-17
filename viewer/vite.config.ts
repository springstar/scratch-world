import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to the backend during development
      "/scenes": "http://localhost:3001",
      "/interact": "http://localhost:3001",
    },
  },
  build: {
    outDir: "dist",
  },
});
