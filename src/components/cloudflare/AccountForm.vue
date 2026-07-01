<template>
	<UForm
		:schema="schema"
		:state="state"
		class="space-y-4"
		@submit="onSubmit"
	>
		<UAlert
			color="info"
			variant="subtle"
			icon="mdi:shield-lock"
			title="Tokens Are Encrypted"
			description="API tokens are sealed with Envelope Encryption and never returned by the API; only the last 4 characters are ever shown."
		/>

		<UFormField
			label="Label"
			name="label"
		>
			<UInput
				v-model="state.label"
				placeholder="My Cloudflare account"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			label="Account ID"
			name="accountId"
			help="32-character hex Cloudflare account id"
		>
			<UInput
				v-model="state.accountId"
				placeholder="abcdef0123456789abcdef0123456789"
				class="w-full font-mono"
				:disabled="isEdit"
			/>
		</UFormField>

		<UFormField
			label="API Token"
			name="apiToken"
			:help="isEdit ? 'Leave blank to keep the existing token' : 'Workers AI Read + Write'"
		>
			<UInput
				v-model="state.apiToken"
				type="password"
				autocomplete="off"
				:placeholder="isEdit ? '**** (unchanged)' : 'Cloudflare API token'"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			label="Token Scope"
			name="tokenScope"
		>
			<USelect
				v-model="state.tokenScope"
				:items="scopeItems"
				value-key="value"
				class="w-full"
			/>
		</UFormField>

		<div
			v-if="isEdit"
			class="space-y-3"
		>
			<UButton
				icon="mdi:shield-check"
				color="neutral"
				variant="outline"
				size="sm"
				:loading="checking"
				@click="onCheckPublish"
			>
				Check Publish Permission
			</UButton>

			<UAlert
				v-if="publishResult === true"
				color="success"
				variant="subtle"
				icon="mdi:check-circle"
				title="Can Publish"
				description="This token can publish (Workers AI: Edit)."
			/>
			<UAlert
				v-else-if="publishResult === false"
				color="error"
				variant="subtle"
				icon="mdi:close-circle"
				title="No Publish Permission"
				:description="`${publishDetail} Create a token with Workers AI: Edit and update this account.`"
			/>
			<UAlert
				v-else-if="publishChecked"
				color="warning"
				variant="subtle"
				icon="mdi:help-circle"
				title="Unknown"
				:description="publishDetail || 'Could not determine publish permission.'"
			/>
		</div>

		<div class="flex flex-col gap-3 sm:flex-row sm:gap-6">
			<UFormField
				name="shared"
				class="flex-1"
			>
				<USwitch
					v-model="state.shared"
					label="Shared"
					description="Available to all developers, not just you"
				/>
			</UFormField>
			<UFormField
				name="isDefault"
				class="flex-1"
			>
				<USwitch
					v-model="state.isDefault"
					label="Default Account"
					description="Used for native-binding inference"
				/>
			</UFormField>
		</div>

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
				:disabled="loading"
				@click="emit('cancel')"
			>
				Cancel
			</UButton>
			<UButton
				type="submit"
				icon="mdi:content-save"
				:loading="loading"
			>
				{{ isEdit ? 'Save Changes' : 'Add Account' }}
			</UButton>
		</div>
	</UForm>
</template>

<script setup lang="ts">
import type { FormSubmitEvent } from '#ui/types';

const props = defineProps<{ account?: PublicCloudflareAccount }>();
const emit = defineEmits<{ submit: [account: PublicCloudflareAccount]; cancel: [] }>();

const store = useCfAccountsStore();
const toast = useToast();

const isEdit = computed(() => !!props.account);
// on edit the token is optional (blank keeps it), so use the update schema
const schema = computed(() =>
	isEdit.value ? cloudflareAccountUpdateSchema : cloudflareAccountSchema
);

const state = reactive<CloudflareAccountInput>({
	label: props.account?.label ?? '',
	accountId: props.account?.accountId ?? '',
	apiToken: '',
	tokenScope: props.account?.tokenScope ?? 'readwrite',
	shared: props.account?.shared ?? false,
	isDefault: props.account?.isDefault ?? false
});

const scopeItems = [
	{ label: 'Read + Write', value: 'readwrite' },
	{ label: 'Read Only', value: 'readonly' }
];

const loading = ref(false);
const error = ref('');

// publish-permission preflight state (edit only)
const checking = ref(false);
const publishChecked = ref(false);
const publishResult = ref<boolean | null>(null);
const publishDetail = ref('');

async function onCheckPublish() {
	if (!props.account?.id) return;
	checking.value = true;
	publishChecked.value = false;
	try {
		const res = await store.preflight(props.account.id);
		publishResult.value = res.canPublish;
		publishDetail.value = res.detail;
		publishChecked.value = true;
	} catch (e: any) {
		publishResult.value = null;
		publishDetail.value =
			e?.data?.message ?? e?.message ?? 'Could not determine publish permission.';
		publishChecked.value = true;
	} finally {
		checking.value = false;
	}
}

async function onSubmit(_event: FormSubmitEvent<any>) {
	loading.value = true;
	error.value = '';
	try {
		let result: PublicCloudflareAccount;
		if (isEdit.value && props.account) {
			// omit a blank token so the server keeps the existing one
			const payload: Record<string, unknown> = {
				label: state.label,
				tokenScope: state.tokenScope,
				shared: state.shared,
				isDefault: state.isDefault
			};
			if (state.apiToken) payload.apiToken = state.apiToken;
			result = await store.update(props.account.id, payload);
		} else {
			result = await store.create({ ...state });
		}
		toast.add({ title: 'Account saved', color: 'success', icon: 'mdi:check' });
		emit('submit', result);
	} catch (e: any) {
		error.value =
			e?.data?.statusMessage ?? e?.data?.message ?? e?.message ?? 'Failed to save account';
	} finally {
		loading.value = false;
	}
}
</script>
