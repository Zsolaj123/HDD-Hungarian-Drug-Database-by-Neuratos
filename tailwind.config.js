/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			colors: {
				// Node type colors (WCAG AAA compliant on dark backgrounds)
				admission: '#3b82f6', // Blue-500
				drug: '#10b981', // Emerald-500
				finding: '#f59e0b', // Amber-500
				task: '#8b5cf6', // Violet-500
				note: '#6b7280', // Gray-500
				history: '#06b6d4', // Cyan-500
				// Status colors
				'task-pending': '#f59e0b',
				'task-complete': '#10b981',
				// Background
				'canvas-bg': '#0f172a', // Slate-900
				'card-bg': '#1e293b' // Slate-800
			},
			minHeight: {
				touch: '44px' // Constitution Principle III
			},
			minWidth: {
				touch: '44px'
			},
			fontSize: {
				base: '16px' // Minimum per constitution
			}
		}
	},
	plugins: []
};
