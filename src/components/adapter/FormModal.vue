<template>
	<UModal
		:open="open"
		:title="title"
		:class="fullscreen ? 'w-screen h-screen max-w-none! max-h-none!' : 'max-w-[90vw] w-full'"
		@update:open="onOpenChange"
	>
		<template #header>
			<div class="flex items-center justify-between w-full">
				<h3 class="text-lg font-semibold text-highlighted">{{ title }}</h3>
				<div class="flex space-x-2">
					<UButton
						:icon="fullscreen ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'"
						color="neutral"
						variant="ghost"
						:title="fullscreen ? 'Exit Fullscreen' : 'Fullscreen'"
						@click="fullscreen = !fullscreen"
					/>
					<UButton
						icon="mdi:close"
						color="neutral"
						variant="ghost"
						title="Close"
						@click="close"
					/>
				</div>
			</div>
		</template>
		<template #body>
			<AdapterForm
				:mode="mode"
				:adapter="adapter"
				@cancel="close"
				@submit="onFormSubmit"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		open: boolean;
		mode: 'create' | 'edit';
		adapter?: Adapter;
	}>(),
	{ mode: 'create' }
);

const emit = defineEmits<{
	'update:open': [value: boolean];
	submit: [adapter: Adapter | { id: string; slug: string }];
	close: [];
}>();

const fullscreen = ref(false);

const title = computed(() => (props.mode === 'create' ? 'New adapter' : 'Edit adapter'));

function onOpenChange(value: boolean) {
	emit('update:open', value);
	if (!value) {
		fullscreen.value = false;
		emit('close');
	}
}

function close() {
	fullscreen.value = false;
	emit('update:open', false);
	emit('close');
}

function onFormSubmit(adapter: Adapter | { id: string; slug: string }) {
	emit('submit', adapter);
}
</script>
