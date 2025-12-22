import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

// tailwindcss, eslint, prettier, etc. plugins can be added here

// Docs: https://rsbuild.rs/config/
export default defineConfig({
	plugins: [pluginReact()],
});
