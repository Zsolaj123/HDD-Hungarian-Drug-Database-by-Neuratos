<script lang="ts">
	import { goto } from '$app/navigation';
	import { Pill, Search, FileText, Database, Zap, Globe, Shield, Activity } from 'lucide-svelte';

	let searchQuery = $state('');

	function handleSearch() {
		if (searchQuery.trim()) {
			goto(`/drugs?q=${encodeURIComponent(searchQuery.trim())}`);
		} else {
			goto('/drugs');
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleSearch();
		}
	}
</script>

<svelte:head>
	<title>HDD - Hungarian Drug Database by Neuratos</title>
	<meta name="description" content="Comprehensive Hungarian drug database with 46,485 drugs from NEAK, FDA clinical data, and OGYÉI authorization status." />
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
	<!-- Hero Section -->
	<div class="relative overflow-hidden">
		<div class="absolute inset-0 bg-gradient-to-r from-blue-600/10 via-transparent to-cyan-600/10"></div>
		<div class="max-w-6xl mx-auto px-4 py-16 sm:py-24 relative">
			<div class="text-center">
				<!-- Logo & Title -->
				<div class="flex items-center justify-center gap-4 mb-6">
					<div class="p-3 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl shadow-lg shadow-blue-500/25">
						<Pill class="h-10 w-10 text-white" />
					</div>
					<div class="text-left">
						<h1 class="text-4xl sm:text-5xl font-bold text-white tracking-tight">
							HDD
						</h1>
						<p class="text-lg text-blue-400 font-medium">Hungarian Drug Database</p>
					</div>
				</div>

				<p class="text-xl text-slate-300 mb-2">by Neuratos</p>
				<p class="text-slate-400 max-w-2xl mx-auto mb-10">
					Átfogó magyar gyógyszeradatbázis NEAK, FDA és OGYÉI integrációval.
					Keresés hatóanyag, gyógyszernév vagy ATC kód alapján.
				</p>

				<!-- Search Box -->
				<div class="max-w-2xl mx-auto mb-12">
					<div class="relative">
						<div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
							<Search class="h-5 w-5 text-slate-400" />
						</div>
						<input
							type="text"
							bind:value={searchQuery}
							onkeydown={handleKeydown}
							placeholder="Keresés gyógyszer neve, hatóanyag vagy ATC kód alapján..."
							class="w-full pl-12 pr-32 py-4 bg-slate-800/80 border border-slate-700 rounded-2xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-lg"
						/>
						<button
							onclick={handleSearch}
							class="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-xl transition-all shadow-lg shadow-blue-500/25"
						>
							Keresés
						</button>
					</div>
				</div>

				<!-- Quick Stats -->
				<div class="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto mb-16">
					<div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
						<div class="text-3xl font-bold text-blue-400">46,485</div>
						<div class="text-sm text-slate-400">Gyógyszer</div>
					</div>
					<div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
						<div class="text-3xl font-bold text-emerald-400">23,664</div>
						<div class="text-sm text-slate-400">BNO kód</div>
					</div>
					<div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
						<div class="text-3xl font-bold text-amber-400">758</div>
						<div class="text-sm text-slate-400">EU támogatási pont</div>
					</div>
					<div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
						<div class="text-3xl font-bold text-cyan-400">40,520</div>
						<div class="text-sm text-slate-400">OGYÉI termék</div>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Features Section -->
	<div class="max-w-6xl mx-auto px-4 pb-16">
		<h2 class="text-2xl font-bold text-white text-center mb-10">Funkciók</h2>
		<div class="grid md:grid-cols-3 gap-6">
			<!-- Drug Search -->
			<a href="/drugs" class="group bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6 hover:border-blue-500/50 hover:bg-slate-800/80 transition-all">
				<div class="p-3 bg-blue-500/20 rounded-xl w-fit mb-4 group-hover:bg-blue-500/30 transition-colors">
					<Pill class="h-6 w-6 text-blue-400" />
				</div>
				<h3 class="text-lg font-semibold text-white mb-2">Gyógyszer Keresés</h3>
				<p class="text-slate-400 text-sm">
					Keresés 46,485 gyógyszer között név, hatóanyag vagy ATC kód alapján.
					Részletes információk adagolásról és kiszerelésről.
				</p>
			</a>

			<!-- BNO Codes -->
			<a href="/bno" class="group bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6 hover:border-emerald-500/50 hover:bg-slate-800/80 transition-all">
				<div class="p-3 bg-emerald-500/20 rounded-xl w-fit mb-4 group-hover:bg-emerald-500/30 transition-colors">
					<FileText class="h-6 w-6 text-emerald-400" />
				</div>
				<h3 class="text-lg font-semibold text-white mb-2">BNO Kódok</h3>
				<p class="text-slate-400 text-sm">
					23,664 ICD-10 diagnózis kód keresése és böngészése.
					Szervrendszer szerinti szűrés és gyógyszer-indikáció kapcsolatok.
				</p>
			</a>

			<!-- GYSE -->
			<a href="/gyse" class="group bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6 hover:border-amber-500/50 hover:bg-slate-800/80 transition-all">
				<div class="p-3 bg-amber-500/20 rounded-xl w-fit mb-4 group-hover:bg-amber-500/30 transition-colors">
					<Database class="h-6 w-6 text-amber-400" />
				</div>
				<h3 class="text-lg font-semibold text-white mb-2">GYSE / EU Pontok</h3>
				<p class="text-slate-400 text-sm">
					758 EU támogatási pont böngészése. Felírási jogosultságok,
					indikációk és támogatási feltételek egy helyen.
				</p>
			</a>
		</div>

		<!-- Data Sources -->
		<div class="mt-16">
			<h2 class="text-2xl font-bold text-white text-center mb-10">Adatforrások</h2>
			<div class="grid md:grid-cols-4 gap-4">
				<div class="bg-slate-800/30 border border-slate-700/30 rounded-xl p-4 text-center">
					<div class="text-blue-400 font-semibold mb-1">NEAK</div>
					<div class="text-xs text-slate-500">pupha_kozos.mdb</div>
				</div>
				<div class="bg-slate-800/30 border border-slate-700/30 rounded-xl p-4 text-center">
					<div class="text-red-400 font-semibold mb-1">OpenFDA</div>
					<div class="text-xs text-slate-500">Drug Label API</div>
				</div>
				<div class="bg-slate-800/30 border border-slate-700/30 rounded-xl p-4 text-center">
					<div class="text-cyan-400 font-semibold mb-1">OGYÉI</div>
					<div class="text-xs text-slate-500">Engedélyezett termékek</div>
				</div>
				<div class="bg-slate-800/30 border border-slate-700/30 rounded-xl p-4 text-center">
					<div class="text-emerald-400 font-semibold mb-1">ICD-10 HU</div>
					<div class="text-xs text-slate-500">BNO kódok</div>
				</div>
			</div>
		</div>

		<!-- Footer -->
		<div class="mt-16 text-center text-slate-500 text-sm">
			<p>HDD - Hungarian Drug Database by Neuratos</p>
			<p class="mt-1">MIT License | <a href="https://github.com/Zsolaj123/HDD-Hungarian_drug_database" class="text-blue-400 hover:underline">GitHub</a></p>
		</div>
	</div>
</div>
