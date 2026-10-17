<template>
	<form
		class="space-y-4"
		@submit.prevent="onSubmit"
	>
		<UFormField
			label="Label"
			name="label"
		>
			<UInput
				v-model="state.label"
				placeholder="Home GPU box"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			label="Base URL"
			name="baseUrl"
			help="An https URL ending in the OpenAI-compatible root, for example https://vllm.example.com/v1"
		>
			<UInput
				v-model="state.baseUrl"
				placeholder="https://vllm.example.com/v1"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			label="Default Model"
			name="defaultModel"
			help="Used when an adapter does not set its own model name"
		>
			<UInput
				v-model="state.defaultModel"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			label="API Key"
			name="apiKey"
			:help="
				endpoint?.keyLast4
					? `A key ending in ${endpoint.keyLast4} is saved. Leave blank to keep it.`
					: 'Sent as a Bearer token from the server. Stored encrypted and never shown again.'
			"
		>
			<UInput
				v-model="state.apiKey"
				type="password"
				autocomplete="new-password"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			name="shared"
			description="Anyone who can see an adapter on a shared endpoint can test it, within the rate limits"
		>
			<USwitch
				v-model="state.shared"
				label="Shared"
			/>
		</UFormField>

		<UAlert
			v-if="error"
			color="error"
			variant="subtle"
			icon="mdi:alert-circle"
			:title="error"
		/>

		<div class="flex flex-wrap justify-end gap-2">
			<UButton
				color="neutral"
				variant="outline"
				@click="emit('cancel')"
			>
				Cancel
			</UButton>
			<UButton
				type="submit"
				icon="mdi:content-save"
				:loading="saving"
			>
				{{ endpoint ? 'Save Changes' : 'Add Endpoint' }}
			</UButton>
		</div>
	</form>
</template>

<script setup lang="ts">
const props = defineProps<{ endpoint?: PublicEndpoint }>();
const emit = defineEmits<{ submit: [endpoint: PublicEndpoint]; cancel: [] }>();

const store = useEndpointsStore();
const saving = ref(false);
const error = ref('');

const state = reactive({
	label: props.endpoint?.label ?? '',
	baseUrl: props.endpoint?.baseUrl ?? '',
	defaultModel: props.endpoint?.defaultModel ?? '',
	apiKey: '',
	shared: props.endpoint?.shared ?? false
});

async function onSubmit() {
	error.value = '';
	saving.value = true;
	try {
		const saved = props.endpoint
			? await store.update(props.endpoint.id, { ...state })
			: await store.create({ ...state });
		emit('submit', saved);
	} catch (e: any) {
		error.value = e?.data?.statusMessage || e?.statusMessage || 'Could not save the endpoint';
	} finally {
		saving.value = false;
	}
}
</script>
