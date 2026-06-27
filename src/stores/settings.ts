import {
	DEFAULT_ACCESS,
	DEFAULT_FEATURES,
	DEFAULT_LIMITS,
	DEFAULT_PERMISSIONS,
	DEFAULT_RATE_LIMITS
} from '~/shared/defaults';
import type {
	AccessSettings,
	FeatureFlags,
	LimitsSettings,
	PermissionMatrix,
	RateLimits
} from '~/shared/types';

// full settings doc; branding/social plus access/permissions/rateLimits/limits/features
export type FullSettings = {
	name?: string;
	description?: string;
	author?: string;
	bio?: string;
	themeColor?: string;
	favicon?: string;
	faviconPng?: string;
	website?: string;
	github?: string;
	twitter?: string;
	instagram?: string;
	patreon?: string;
	linkedin?: string;
	discord?: string;
	supportEmail?: string;
	access?: AccessSettings;
	permissions?: PermissionMatrix;
	rateLimits?: RateLimits;
	limits?: LimitsSettings;
	features?: FeatureFlags;
};

export const useSettingsStore = defineStore('settings', () => {
	const settings = ref<FullSettings>({});
	const loaded = ref(false);
	const loading = ref(false);
	const error = ref<string | null>(null);

	// idempotent; only hits the api once unless forced
	async function fetch(force = false) {
		if (loaded.value && !force) return settings.value;
		if (loading.value) return settings.value;
		loading.value = true;
		error.value = null;
		try {
			settings.value = await $fetch<FullSettings>('/api/settings');
			loaded.value = true;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to load settings';
			throw e;
		} finally {
			loading.value = false;
		}
		return settings.value;
	}

	async function save(partial: Partial<FullSettings>) {
		loading.value = true;
		error.value = null;
		try {
			settings.value = await $fetch<FullSettings>('/api/settings', {
				method: 'POST',
				body: partial
			});
			loaded.value = true;
			return settings.value;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to save settings';
			throw e;
		} finally {
			loading.value = false;
		}
	}

	// typed getters with defaults so consumers never see undefined
	const permissions = computed(() => settings.value.permissions ?? DEFAULT_PERMISSIONS);
	const access = computed(() => settings.value.access ?? DEFAULT_ACCESS);
	const rateLimits = computed(() => settings.value.rateLimits ?? DEFAULT_RATE_LIMITS);
	const limits = computed(() => settings.value.limits ?? DEFAULT_LIMITS);
	const features = computed(() => settings.value.features ?? DEFAULT_FEATURES);

	const themeColor = computed(() => settings.value.themeColor);
	const name = computed(() => settings.value.name);
	const description = computed(() => settings.value.description);
	const author = computed(() => settings.value.author);
	const bio = computed(() => settings.value.bio);
	const website = computed(() => settings.value.website);
	const github = computed(() => settings.value.github);
	const twitter = computed(() => settings.value.twitter);
	const instagram = computed(() => settings.value.instagram);
	const patreon = computed(() => settings.value.patreon);
	const linkedin = computed(() => settings.value.linkedin);
	const discord = computed(() => settings.value.discord);
	const supportEmail = computed(() => settings.value.supportEmail);

	return {
		settings,
		loaded,
		loading,
		error,
		fetch,
		save,
		permissions,
		access,
		rateLimits,
		limits,
		features,
		themeColor,
		name,
		description,
		author,
		bio,
		website,
		github,
		twitter,
		instagram,
		patreon,
		linkedin,
		discord,
		supportEmail
	};
});
