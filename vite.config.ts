import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
	plugins: [react()],
	build: {
		chunkSizeWarningLimit: 650,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes('@codemirror') || id.includes('node_modules/codemirror')) {
						return 'codemirror';
					}
					if (id.includes('highlight.js')) {
						return 'highlightjs';
					}
					if (id.includes('markdown-it')) {
						return 'markdown-it';
					}
					if (id.includes('node_modules/katex')) {
						return 'katex';
					}
					if (id.includes('node_modules/mermaid') || id.includes('node_modules/d3') || id.includes('node_modules/dagre') || id.includes('node_modules/elkjs')) {
						return 'mermaid';
					}
				}
			}
		}
	},
	server: {
		host: '0.0.0.0',
		proxy: {
			'/api': {
				target: 'http://localhost:8081',
				changeOrigin: true
			},
			'/todos.json': {
				target: 'http://localhost:8081',
				changeOrigin: true
			}
		}
	}
});
