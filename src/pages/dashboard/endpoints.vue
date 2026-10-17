<template>
	<UDashboardPanel id="endpoints">
		<template #header>
			<UDashboardNavbar
				title="Endpoints"
				icon="mdi:api"
			>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<UAlert
				icon="mdi:information-outline"
				color="info"
				variant="subtle"
				title="Serve Adapters Beyond Workers AI"
			>
				<template #description>
					<p>
						Point MyLoRA at any <strong>OpenAI-compatible</strong> endpoint, or have it start
						<strong>vLLM</strong> with your adapters on a registered machine. Then choose the
						endpoint on an adapter to make its tester run there instead of on Cloudflare.
					</p>
				</template>
			</UAlert>

			<EndpointTable />
			<EndpointTokens />
		</template>
	</UDashboardPanel>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'endpoints' });
useSeoMeta({ title: 'Endpoints' });
</script>
