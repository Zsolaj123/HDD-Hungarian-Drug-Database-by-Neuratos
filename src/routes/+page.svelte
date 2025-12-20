<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => {
		goto('/drugs', { replaceState: true });
	});
</script>

<svelte:head>
	<title>HDD - Hungarian Drug Database</title>
</svelte:head>

<div class="min-h-screen bg-slate-900 flex items-center justify-center">
	<p class="text-slate-400">Redirecting...</p>
</div>
