<template>
	<div class="space-y-3">
		<div
			v-if="modelValue.length"
			class="grid grid-cols-2 sm:grid-cols-3 gap-3"
		>
			<div
				v-for="(shot, idx) in modelValue"
				:key="shot"
				class="group relative aspect-video overflow-hidden rounded-lg border border-default bg-elevated/60"
			>
				<NuxtImg
					:src="screenshotUrl(shot)"
					:alt="`screenshot ${idx + 1}`"
					class="h-full w-full object-cover"
					loading="lazy"
				/>
				<UButton
					icon="mdi:close"
					color="error"
					variant="solid"
					size="xs"
					class="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100"
					:loading="removingIdx === idx"
					title="Remove Screenshot"
					@click="remove(idx)"
				/>
			</div>
		</div>

		<UFileUpload
			v-if="modelValue.length < maxScreenshots"
			v-model="picked"
			accept="image/*"
			:label="`Add Screenshot (${modelValue.length}/${maxScreenshots})`"
			description="PNG, JPEG, WebP or GIF up to 5MB"
			icon="mdi:image-plus"
			:disabled="uploading"
		/>
		<p
			v-else
			class="text-xs text-muted"
		>
			Maximum of {{ maxScreenshots }} screenshots reached.
		</p>

		<UAlert
			v-if="error"
			color="error"
			variant="subtle"
			icon="mdi:alert-circle"
			:title="error"
		/>
	</div>
</template>

<script setup lang="ts">
const props = defineProps<{
	adapterId: string;
	modelValue: string[];
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

const uploadStore = useUploadStore();
const settings = useSettingsStore();
const { limits } = storeToRefs(settings);

const maxScreenshots = computed(() => limits.value.maxScreenshots);

const picked = ref<File | null>(null);
const uploading = ref(false);
const removingIdx = ref<number | null>(null);
const error = ref('');

function screenshotUrl(pathname: string) {
	if (/^(https?:)?\//.test(pathname)) return pathname;
	return `/files/${pathname}`;
}

// upload as soon as a file is picked; the store targets the active draft id
watch(picked, async (file) => {
	if (!file) return;
	uploading.value = true;
	error.value = '';
	try {
		const res = await uploadStore.uploadScreenshot(file);
		emit('update:modelValue', res.screenshots);
	} catch (e: any) {
		error.value = e?.data?.message ?? e?.message ?? 'Screenshot upload failed';
	} finally {
		uploading.value = false;
		picked.value = null;
	}
});

async function remove(idx: number) {
	removingIdx.value = idx;
	error.value = '';
	try {
		const res = await $fetch<{ screenshots: string[] }>(
			`/api/adapters/${props.adapterId}/screenshots/${idx}`,
			{ method: 'DELETE' }
		);
		emit('update:modelValue', res.screenshots);
	} catch (e: any) {
		error.value = e?.data?.statusMessage ?? e?.message ?? 'Failed to remove screenshot';
	} finally {
		removingIdx.value = null;
	}
}
</script>
