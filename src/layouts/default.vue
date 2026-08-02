<template>
	<a
		href="#main-content"
		class="sr-only rounded-b-lg bg-primary px-4 py-2 text-inverted focus:not-sr-only focus:absolute focus:top-0 focus:left-4 focus:z-50"
	>
		Skip to Content
	</a>
	<NavBar />
	<main
		id="main-content"
		class="min-h-[90dvh] w-full"
	>
		<slot />
	</main>
	<Footer />
</template>
