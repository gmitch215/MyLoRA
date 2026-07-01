// single source of truth for failure-class -> human title (shared by the job card + detail modal)
const FAILURE_TITLES: Record<FailureClass, string> = {
	none: 'Training Failed',
	reported: 'Training Reported a Failure',
	abnormal: 'Training Ended Abnormally',
	preflight: 'Preflight Check Failed',
	verify: 'Output Verification Failed',
	sync: 'Result Sync Failed',
	aborted: 'Training Aborted',
	gated: 'Model Access Denied'
};

export function failureTitle(fc: FailureClass): string {
	return FAILURE_TITLES[fc] ?? 'Training Failed';
}

export function useFailureTitles() {
	return FAILURE_TITLES;
}
