declare module '#auth-utils' {
	interface User {
		id: string;
		username: string;
		displayName: string;
		role: 'administrator' | 'manager' | 'developer';
		avatarPathname?: string | null;
		bio?: string | null;
	}

	interface UserSession {
		loggedInAt: number;
	}

	interface SecureSessionData {}
}

export {};
