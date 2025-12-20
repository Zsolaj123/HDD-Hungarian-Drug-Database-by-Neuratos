import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		allowedHosts: [
			'localhost',
			'.trycloudflare.com' // Allow all Cloudflare tunnel subdomains
		]
	}
});
