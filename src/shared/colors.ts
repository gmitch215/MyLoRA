export const NUXT_COLORS = [
	'primary',
	'secondary',
	'success',
	'info',
	'warning',
	'error',
	'neutral'
] as const;

export type NuxtColor = (typeof NUXT_COLORS)[number];

export function isNuxtColor(v?: string | null): v is NuxtColor {
	return !!v && (NUXT_COLORS as readonly string[]).includes(v);
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_RE = /^rgba?\(/i;

export function isCustomColor(v?: string | null): boolean {
	return !!v && (HEX_RE.test(v) || RGB_RE.test(v));
}

// resolve any stored color into a css color value usable in `style="color: ..."`/`background`
export function resolveColorVar(v?: string | null, fallback = 'var(--ui-text-muted)'): string {
	if (!v) return fallback;
	if (isNuxtColor(v)) return `var(--ui-color-${v}-500)`;
	if (isCustomColor(v)) return v;
	return fallback;
}
