<template>
	<div class="scrollbar-hide overflow-x-auto rounded border border-default">
		<table class="min-w-full text-sm">
			<thead class="bg-elevated/40 text-muted">
				<tr>
					<th class="p-3 text-left font-medium">Capability</th>
					<th class="p-3 text-center font-medium">Developer</th>
					<th class="p-3 text-center font-medium">Manager</th>
					<th class="p-3 text-center font-medium">
						Administrator
						<UIcon
							name="mdi:lock"
							class="size-3 ml-0.5 align-middle text-dimmed"
						/>
					</th>
				</tr>
			</thead>
			<tbody>
				<tr
					v-for="cap in capabilities"
					:key="cap.key"
					class="border-t border-default"
				>
					<td class="p-3">
						<div class="font-medium text-highlighted">{{ cap.label }}</div>
						<div class="text-xs text-muted">{{ cap.description }}</div>
					</td>
					<td class="p-3">
						<div class="flex justify-center">
							<USwitch
								:model-value="model.developer[cap.key]"
								@update:model-value="update('developer', cap.key, $event)"
							/>
						</div>
					</td>
					<td class="p-3">
						<div class="flex justify-center">
							<USwitch
								:model-value="model.manager[cap.key]"
								@update:model-value="update('manager', cap.key, $event)"
							/>
						</div>
					</td>
					<td class="p-3">
						<!-- administrator always has every capability -->
						<div class="flex justify-center">
							<USwitch
								:model-value="true"
								disabled
							/>
						</div>
					</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue: PermissionMatrix }>();
const emit = defineEmits<{ 'update:modelValue': [value: PermissionMatrix] }>();

const model = computed(() => props.modelValue);

const capabilities: { key: keyof Capability; label: string; description: string }[] = [
	{ key: 'canCreate', label: 'Create Adapters', description: 'Upload new adapters' },
	{ key: 'canEditOwn', label: 'Edit Own', description: 'Edit adapters they authored' },
	{ key: 'canEditAny', label: 'Edit Any', description: "Edit anyone's adapter" },
	{ key: 'canDeleteOwn', label: 'Delete Own', description: 'Delete adapters they authored' },
	{ key: 'canDeleteAny', label: 'Delete Any', description: "Delete anyone's adapter" },
	{ key: 'canPublish', label: 'Publish', description: 'Push adapters to Cloudflare' },
	{
		key: 'canManageAccounts',
		label: 'Manage Accounts',
		description: 'Add/edit Cloudflare accounts'
	},
	{
		key: 'canManageMachines',
		label: 'Manage Machines',
		description: 'Add/edit any training machine'
	},
	{ key: 'canTrain', label: 'Train', description: 'Launch and manage training jobs' },
	{
		key: 'unlimitedTester',
		label: 'Unlimited Testing',
		description: 'Bypass inference rate limits'
	}
];

function update(role: 'developer' | 'manager', key: keyof Capability, value: boolean) {
	emit('update:modelValue', {
		...props.modelValue,
		[role]: { ...props.modelValue[role], [key]: value }
	});
}
</script>
