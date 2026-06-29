type MenuOpts = {
	onEdit?: (a: Adapter) => void;
	onDelete?: (a: Adapter) => void;
	onPublish?: (a: Adapter) => void;
};

export function useAdapterMenu(opts: MenuOpts = {}) {
	const auth = useAuthStore();
	const toast = useToast();

	function copy(text: string, message: string) {
		if (!import.meta.client) return;
		navigator.clipboard.writeText(text);
		toast.add({ title: message, icon: 'mdi:check', color: 'success' });
	}

	return function build(a: Adapter): any[][] {
		const origin = import.meta.client ? window.location.origin : '';
		const own = !!auth.user && a.authorId === auth.user.id;
		const canEdit = auth.can('canEditAny') || (own && auth.can('canEditOwn'));
		const canDelete = auth.can('canDeleteAny') || (own && auth.can('canDeleteOwn'));
		const canPublish = auth.can('canPublish') && (a.status === 'listed' || a.status === 'failed');
		const hasFiles = a.configBytes > 0 && a.weightsBytes > 0;

		const primary: any[] = [
			{ label: 'Open', icon: 'mdi:open-in-app', to: `/adapters/${a.slug}` },
			{
				label: 'Copy Link',
				icon: 'mdi:link-variant',
				color: 'primary',
				onSelect: () => copy(`${origin}/adapters/${a.slug}`, 'Link copied')
			}
		];
		if (hasFiles)
			primary.push({
				label: 'Copy Install Command',
				icon: 'mdi:console',
				color: 'info',
				onSelect: () =>
					copy(
						`curl -fsSL ${origin}/adapters/${a.slug}/install.sh | bash`,
						'Install command copied'
					)
			});
		if (auth.loggedIn && isTestable(a.status))
			primary.push({
				label: 'Test in Playground',
				icon: 'mdi:flask',
				to: '/playground',
				color: 'warning'
			});

		const manage: any[] = [];
		if (canPublish && opts.onPublish)
			manage.push({
				label: 'Publish',
				icon: 'mdi:cloud-upload',
				onSelect: () => opts.onPublish!(a)
			});
		if (canEdit)
			manage.push({
				label: 'Edit',
				icon: 'mdi:pencil',
				onSelect: () => (opts.onEdit ? opts.onEdit(a) : navigateTo(`/adapters/${a.slug}?edit=1`))
			});
		if (canDelete)
			manage.push({
				label: 'Delete',
				icon: 'mdi:delete',
				color: 'error',
				onSelect: () =>
					opts.onDelete ? opts.onDelete(a) : navigateTo(`/adapters/${a.slug}?delete=1`)
			});

		return manage.length ? [primary, manage] : [primary];
	};
}
