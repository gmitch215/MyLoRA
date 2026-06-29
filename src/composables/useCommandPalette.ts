export function useCommandPalette() {
	const open = useState('cmdk:open', () => false);
	return {
		open,
		toggle: () => (open.value = !open.value),
		show: () => (open.value = true),
		hide: () => (open.value = false)
	};
}
