<template>
	<div class="flex flex-col gap-3 rounded-lg border border-default p-4 bg-elevated/50">
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-2">
				<h3 class="text-sm font-semibold text-highlighted flex items-center gap-2">
					<UIcon
						name="mdi:flask"
						class="size-4"
					/>
					Try It Out
				</h3>
				<UTooltip :text="accessTooltip">
					<UBadge
						:color="isFull ? 'success' : 'warning'"
						variant="subtle"
						size="sm"
						:icon="isFull ? 'mdi:infinity' : 'mdi:speedometer-slow'"
					>
						{{ isFull ? 'Full' : 'Limited' }}
					</UBadge>
				</UTooltip>
			</div>
			<div
				v-if="hasMessages"
				class="flex items-center gap-0.5"
			>
				<UTooltip :text="exporter.copied.value ? 'Copied' : 'Copy Conversation'">
					<UButton
						:icon="exporter.copied.value ? 'mdi:check' : 'mdi:content-copy'"
						size="xs"
						variant="ghost"
						color="neutral"
						aria-label="Copy Conversation"
						@click="copyAll"
					/>
				</UTooltip>
				<UTooltip text="Download Conversation">
					<UButton
						icon="mdi:download"
						size="xs"
						variant="ghost"
						color="neutral"
						aria-label="Download Conversation"
						@click="downloadAll"
					/>
				</UTooltip>
				<UTooltip text="Clear Conversation">
					<UButton
						icon="mdi:broom"
						size="xs"
						variant="ghost"
						color="neutral"
						aria-label="Clear Conversation"
						@click="inference.clear(adapter.id)"
					/>
				</UTooltip>
			</div>
		</div>

		<!-- only published/migrated adapters are testable -->
		<UAlert
			v-if="!isTestable(adapter.status)"
			color="neutral"
			variant="subtle"
			icon="mdi:information-outline"
			title="Not Yet Testable"
			description="This adapter has not been published to Cloudflare, so live inference is unavailable."
		/>

		<!-- access gate: tester requires login -->
		<UAlert
			v-else-if="needsLogin"
			color="info"
			variant="subtle"
			icon="mdi:account-lock"
			title="Log In to Test"
			description="Inference testing requires you to be logged in."
		>
			<template #actions>
				<UButton
					size="xs"
					color="info"
					to="/?login=1"
					label="Log In"
				/>
			</template>
		</UAlert>

		<template v-else>
			<!-- optional system message -->
			<div v-if="maxSystemChars > 0">
				<UButton
					:icon="showSystem ? 'mdi:chevron-down' : 'mdi:chevron-right'"
					size="xs"
					variant="link"
					color="neutral"
					class="px-0"
					@click="showSystem = !showSystem"
				>
					System Message
				</UButton>
				<UTextarea
					v-if="showSystem"
					v-model="system"
					:rows="2"
					:maxlength="maxSystemChars"
					placeholder="Optional system instructions for the model..."
					class="mt-1 w-full"
				/>
			</div>

			<AiContextMeter
				v-if="hasMessages"
				:used="usedTokens"
				:total="contextWindow"
			/>

			<AiChatThread
				:nodes="path"
				:loading="session.loading"
				editable
				class="max-h-80"
				@edit="onEdit"
				@branch="onBranch"
			>
				<template #empty>Send a prompt to test this adapter.</template>
			</AiChatThread>

			<UBanner
				v-if="session.rateLimited"
				color="warning"
				icon="mdi:timer-sand"
				:title="rateLimitMessage"
				class="rounded"
			/>
			<UAlert
				v-else-if="session.error"
				color="error"
				variant="subtle"
				icon="mdi:alert-circle"
				:title="session.error"
			/>

			<UChatPrompt
				v-model="prompt"
				:status="status"
				placeholder="Ask the adapter something..."
				:disabled="session.rateLimited"
				@submit="onSubmit"
				@stop="onStop"
			>
				<UChatPromptSubmit
					:status="status"
					@stop="onStop"
				/>
			</UChatPrompt>
		</template>
	</div>
</template>

<script setup lang="ts">
const props = defineProps<{ adapter: Adapter }>();

const inference = useInferenceStore();
const settings = useSettingsStore();
const auth = useAuthStore();
const { access, limits } = storeToRefs(settings);
const { loggedIn } = storeToRefs(auth);

const prompt = ref('');
const system = ref('');
const showSystem = ref(false);
const maxSystemChars = computed(() => limits.value.maxSystemPromptChars);

// ensure a session object exists for this adapter
const session = computed(
	() =>
		inference.sessions[props.adapter.id] ?? {
			nodes: {},
			roots: [],
			selection: {},
			loading: false,
			error: null,
			rateLimited: false,
			retryAfter: null
		}
);

// active conversation path (chatgpt-style branches resolved by the store)
const path = computed(() => inference.pathOf(props.adapter.id));
const hasMessages = computed(() => path.value.some((n) => n.content?.trim()));

// context metering against the adapter's base model window
const contextWindow = computed(() => contextWindowFor(props.adapter.baseModel));
const usedTokens = computed(() => estimateTokens(path.value.map((n) => n.content).join('\n')));

const exporter = useChatExport();
function transcript() {
	return chatToText(path.value, { title: `${props.adapter.name} - Test Conversation` });
}
function copyAll() {
	exporter.copy(transcript());
}
function downloadAll() {
	exporter.download(transcript(), `${props.adapter.slug}-conversation`);
}

const needsLogin = computed(() => access.value.testerAccess === 'login' && !loggedIn.value);

// logged-in users (owner/developer/manager) test on the developer tier; the public is rate-limited
const isFull = computed(() => loggedIn.value);
const accessTooltip = computed(() =>
	isFull.value ? 'Logged in: full developer testing budget' : 'Public access: rate-limited testing'
);

// chat status drives the prompt/submit ui state ('streaming' shows the stop button)
const status = computed<'submitted' | 'streaming' | 'ready' | 'error'>(() => {
	if (session.value.loading) return 'streaming';
	if (session.value.error && !session.value.rateLimited) return 'error';
	return 'ready';
});

function onStop() {
	inference.stop(props.adapter.id);
}

// live countdown for the rate-limit banner; derive a deadline from retryAfter seconds
const remaining = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;
watch(
	() => [session.value.rateLimited, session.value.retryAfter] as const,
	([limited, ra]) => {
		if (timer) clearInterval(timer);
		if (limited && ra && ra > 0) {
			const deadline = Date.now() + ra * 1000;
			remaining.value = ra;
			timer = setInterval(() => {
				remaining.value = Math.max(0, Math.round((deadline - Date.now()) / 1000));
				if (remaining.value <= 0 && timer) clearInterval(timer);
			}, 1000);
		} else {
			remaining.value = 0;
		}
	},
	{ immediate: true }
);
onBeforeUnmount(() => {
	if (timer) clearInterval(timer);
});

const rateLimitMessage = computed(() => {
	if (remaining.value > 0) return `Rate limit reached. Try again in ${remaining.value}s.`;
	return session.value.error || 'Rate limit reached. Try again later.';
});

async function onSubmit() {
	const text = prompt.value.trim();
	if (!text || session.value.loading) return;
	prompt.value = '';
	try {
		await inference.sendWidget(props.adapter.id, text, system.value.trim() || undefined);
	} catch {
		// error state surfaced via the session
	}
}

// edit-and-resend: branch a new version off this user turn (the old branch stays reachable)
async function onEdit({ id, content }: { id: string; content: string }) {
	if (session.value.loading) return;
	try {
		await inference.editWidget(props.adapter.id, id, content, system.value.trim() || undefined);
	} catch {
		// error state surfaced via the session
	}
}

// switch between alternate versions of a turn
function onBranch({ id, dir }: { id: string; dir: number }) {
	inference.branch(props.adapter.id, id, dir);
}
</script>
