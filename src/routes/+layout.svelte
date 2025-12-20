<script>
	import '../app.css';
	import { page } from '$app/stores';
	import { Pill, Accessibility, FileText } from 'lucide-svelte';

	let { children } = $props();

	const isHomePage = $derived($page.url.pathname === '/');
	const isDrugsPage = $derived($page.url.pathname === '/drugs');
	const isGysePage = $derived($page.url.pathname === '/gyse');
	const isBnoPage = $derived($page.url.pathname === '/bno');
</script>

<svelte:head>
	<title>HDD - Hungarian Drug Database by Neuratos</title>
</svelte:head>

<div class="app min-h-screen bg-canvas-bg text-slate-100">
	{#if !isHomePage}
		<header class="bg-slate-800 border-b border-slate-700 px-4 py-2">
			<nav class="max-w-7xl mx-auto flex items-center justify-between">
				<a href="/" class="brand-link">
					<img
						src="/neuratos-logo.png"
						alt="Neuratos"
						class="brand-logo"
					/>
					<span class="brand-title">
						<span class="hdd-prefix">HDD</span>
						Hungarian Drug Database
					</span>
				</a>
				<div class="nav-links">
					<a href="/drugs" class="nav-link" class:active={isDrugsPage}>
						<Pill size={18} />
						<span>Gyógyszerek</span>
					</a>
					<a href="/gyse" class="nav-link" class:active={isGysePage}>
						<Accessibility size={18} />
						<span>GYSE</span>
					</a>
					<a href="/bno" class="nav-link" class:active={isBnoPage}>
						<FileText size={18} />
						<span>BNO</span>
					</a>
				</div>
			</nav>
		</header>
	{/if}

	<main class="flex-1">
		{@render children()}
	</main>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
	}

	.brand-link {
		display: flex;
		align-items: center;
		gap: 12px;
		text-decoration: none;
		transition: opacity 0.2s ease;
	}

	.brand-link:hover {
		opacity: 0.9;
	}

	.brand-logo {
		height: 36px;
		width: auto;
	}

	.brand-title {
		font-family: 'Nunito', sans-serif;
		font-size: 1rem;
		font-weight: 500;
		color: #94a3b8;
		letter-spacing: 0.01em;
	}

	.hdd-prefix {
		font-size: 1.25rem;
		font-weight: 700;
		color: #06b6d4;
		text-shadow: 0 0 10px rgba(6, 182, 212, 0.5), 0 0 20px rgba(6, 182, 212, 0.3);
		margin-right: 6px;
	}

	.nav-links {
		display: flex;
		gap: 0.5rem;
	}

	.nav-link {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		font-size: 0.875rem;
		font-weight: 500;
		color: #94a3b8;
		text-decoration: none;
		transition: all 0.2s ease;
		border: 1px solid transparent;
	}

	.nav-link:hover {
		color: #e2e8f0;
		background: rgba(59, 130, 246, 0.1);
		border-color: rgba(59, 130, 246, 0.3);
	}

	.nav-link.active {
		color: #60a5fa;
		background: rgba(59, 130, 246, 0.15);
		border-color: rgba(59, 130, 246, 0.4);
	}

	@media (max-width: 640px) {
		.nav-links {
			gap: 0.25rem;
		}

		.nav-link span {
			display: none;
		}

		.nav-link {
			padding: 0.5rem;
		}

		.brand-title {
			display: none;
		}
	}
</style>
