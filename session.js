const KEY = "bcts_session";

export function loadSession() {
	return JSON.parse(localStorage.getItem(KEY));
}

export function saveSession(s) {
	localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession() {
	localStorage.removeItem(KEY);
}

export function newSession(version = "A") {
	return {
		version: version,
		index: 0,
		recordings: [],
		transcripts: [],
		finished: false,
	};
}
