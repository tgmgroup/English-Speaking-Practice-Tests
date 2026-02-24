import { QUESTIONS_A, QUESTIONS_B, QUESTIONS_C } from "./questions.js";
import {
	loadSession,
	saveSession,
	clearSession,
	newSession,
} from "./session.js";

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/* ---------- STATE ---------- */
let session = loadSession() || newSession("A");

const questionMap = {
	A: QUESTIONS_A,
	B: QUESTIONS_B,
	C: QUESTIONS_C,
};
const QUESTIONS = questionMap[session.version] || QUESTIONS_A;

// Add this to your init or startTest function
document.querySelector(".logo").textContent = `(Version ${session.version})`;

let audioCtx,
	audioUnlocked = false,
	isRecording = false,
	skip = false;
let mediaRecorder,
	recognition,
	chunks = [];
let analyser, dataArray, resolveCurrentStep;

const wave = document.getElementById("wave");
const ctx = wave.getContext("2d");
const micCanvas = document.getElementById("micTestWave");
const micCtx = micCanvas.getContext("2d");
const screens = ["intro", "thinking", "exam", "results"];
const skipBtn = document.getElementById("skipBtn");

/* ---------- MIC TEST (PRE-EXAM) ---------- */
async function initMicPreview() {
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
		const source = tempCtx.createMediaStreamSource(stream);
		const tempAnalyser = tempCtx.createAnalyser();
		source.connect(tempAnalyser);
		const data = new Uint8Array(tempAnalyser.frequencyBinCount);

		function drawPreview() {
			if (audioUnlocked) return; // Stop preview once test starts
			requestAnimationFrame(drawPreview);
			tempAnalyser.getByteFrequencyData(data);
			micCtx.clearRect(0, 0, micCanvas.width, micCanvas.height);
			micCtx.fillStyle = "#4caf50";
			let sum = 0;
			for (let i = 0; i < 100; i++) sum += data[i];
			let level = sum / 100;
			micCtx.fillRect(0, 0, level * 2, micCanvas.height);
		}
		drawPreview();
	} catch (e) {
		console.log("Mic access denied for preview");
	}
}
initMicPreview();

/* ---------- UTILS ---------- */
function show(id) {
	screens.forEach((s) => document.getElementById(s).classList.remove("active"));
	const target = document.getElementById(id);
	if (target) target.classList.add("active");
}

async function unlockAudio() {
	if (audioUnlocked) return;
	audioCtx = new (window.AudioContext || window.webkitAudioContext)();
	if (audioCtx.state === "suspended") await audioCtx.resume();
	audioUnlocked = true;
}

function beep() {
	if (!audioCtx) return;
	const osc = audioCtx.createOscillator();
	const gain = audioCtx.createGain();
	osc.connect(gain);
	gain.connect(audioCtx.destination);
	osc.frequency.value = 880;
	gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
	osc.start();
	osc.stop(audioCtx.currentTime + 0.2);
}

/* ---------- TTS ---------- */
async function speak(text) {
	if (skip) return;
	return new Promise((res) => {
		resolveCurrentStep = res;
		speechSynthesis.cancel();
		const utter = new SpeechSynthesisUtterance(text.replace(/<br>/g, " "));
		utter.lang = "en-GB";
		utter.onend = () => {
			if (resolveCurrentStep === res) res();
		};
		utter.onerror = () => {
			if (resolveCurrentStep === res) res();
		};
		speechSynthesis.speak(utter);
	});
}

/* ---------- TIMERS ---------- */
async function thinkingCountdown(sec) {
	if (skip) return;

	// 1. Stay on exam screen and show the prep bar
	show("exam");
	const prepArea = document.getElementById("prepArea");
	const prepFill = document.getElementById("prepFill");
	const timeBar = document.getElementById("timeBar"); // The recording bar

	prepArea.style.display = "block";
	timeBar.style.display = "none"; // Hide recording bar while thinking
	prepFill.style.width = "0%";

	return new Promise((resolve) => {
		resolveCurrentStep = resolve;
		let t = sec;

		const timer = setInterval(() => {
			t--;
			const percentage = ((sec - t) / sec) * 100;
			prepFill.style.width = percentage + "%";

			if (t <= 0 || skip) {
				clearInterval(timer);
				prepArea.style.display = "none"; // Hide prep bar when done
				timeBar.style.display = "block"; // Show recording bar for next step
				resolve();
			}
		}, 1000);
	});
}

/* ---------- RECORDING & STT ---------- */
async function record(seconds) {
	if (skip) return;
	isRecording = true;
	show("exam");

	const indicator = document.getElementById("recordingIndicator");
	const fill = document.getElementById("timeFill");
	fill.style.width = "0%";
	indicator.classList.add("active");

	// --- Audio Recording Setup ---
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	mediaRecorder = new MediaRecorder(stream);
	chunks = [];
	mediaRecorder.ondataavailable = (e) => chunks.push(e.data);

	// --- Speech-to-Text Setup ---
	const SpeechRecognition =
		window.SpeechRecognition || window.webkitSpeechRecognition;
	const recognition = new SpeechRecognition();
	recognition.continuous = true;
	recognition.interimResults = false;
	recognition.lang = "en-US";

	let liveTranscript = "";
	recognition.onresult = (event) => {
		for (let i = event.resultIndex; i < event.results.length; ++i) {
			liveTranscript += event.results[i][0].transcript + " ";
		}
	};

	// --- Visualizer Setup ---
	const src = audioCtx.createMediaStreamSource(stream);
	analyser = audioCtx.createAnalyser();
	src.connect(analyser);
	dataArray = new Uint8Array(analyser.frequencyBinCount);
	drawWave();

	return new Promise((resolve) => {
		resolveCurrentStep = resolve;
		let t = seconds;

		const timer = setInterval(() => {
			t--;
			fill.style.width = ((seconds - t) / seconds) * 100 + "%";
			if (t <= 5) fill.classList.add("flash");

			if (t <= 0 || skip) {
				clearInterval(timer);
				if (mediaRecorder.state !== "inactive") {
					mediaRecorder.stop();
					recognition.stop();
					beep(); // End beep
				}
			}
		}, 1000);

		mediaRecorder.onstart = () => recognition.start();

		mediaRecorder.onstop = () => {
			clearInterval(timer);
			indicator.classList.remove("active");
			fill.classList.remove("flash");

			// Stop mic tracks
			stream.getTracks().forEach((track) => track.stop());

			// Save Audio
			const blob = new Blob(chunks, { type: "audio/webm" });
			session.recordings[session.index] = URL.createObjectURL(blob);

			// Save Real Transcript
			session.transcripts[session.index] =
				liveTranscript.trim() || "(No speech detected)";

			isRecording = false;
			resolve();
		};

		mediaRecorder.start();
	});
}

function drawWave() {
	requestAnimationFrame(drawWave);
	if (!analyser || !isRecording) return;
	analyser.getByteTimeDomainData(dataArray);
	ctx.clearRect(0, 0, 320, 90);
	ctx.strokeStyle = "#4caf50";
	ctx.lineWidth = 2;
	ctx.beginPath();
	let x = 0;
	let sliceWidth = 320 / dataArray.length;
	for (let i = 0; i < dataArray.length; i++) {
		let y = (dataArray[i] / 128.0) * 45;
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
		x += sliceWidth;
	}
	ctx.stroke();
}

/* ---------- CORE FLOW ---------- */
async function startTest() {
	await unlockAudio();

	while (session.index < QUESTIONS.length) {
		const q = QUESTIONS[session.index];
		skip = false;

		// 1. Update UI
		document.getElementById("progressTracker").textContent =
			`Question ${session.index + 1} of ${QUESTIONS.length}`;
		document.getElementById("partTitle").textContent = q.part;

		// Show the description visually
		document.getElementById("questionDescription").textContent =
			q.description || "";
		document.getElementById("questionText").innerHTML = q.text;

		skipBtn.textContent =
			session.index === QUESTIONS.length - 1 ? "Finish 🏁" : "Next ▶";
		updateBadges();
		renderImages(q);
		show("exam");

		// 2. Audio Sequence - ONLY speak the question text
		await speak(q.text);

		// 3. Timers and Recording
		if (q.think && !skip) await thinkingCountdown(q.think);

		if (!skip) {
			await delay(1000); // 1-second pause
			beep();
			await record(q.time);
			beep(); // End beep
		}

		// 4. The "Breather" Delay
		if (session.index < QUESTIONS.length - 1 && !skip) {
			document.getElementById("questionText").innerHTML =
				"<em>Saving answer...</em>";
			await delay(3000); // 3-second pause
		}

		session.index++;
		saveSession(session);
		await new Promise((r) => setTimeout(r, 100));
	}
	finish();
}

/* ---------- STATUS BADGES ---------- */
function updateBadges() {
	const container = document.getElementById("statusBadges");
	container.innerHTML = "";

	QUESTIONS.forEach((_, i) => {
		const badge = document.createElement("div");
		badge.className = "status-dot";

		if (i < session.index) {
			// Check if it was skipped or saved
			const isSkipped =
				session.transcripts[i] === "(Skipped)" || !session.recordings[i];
			badge.classList.add(isSkipped ? "skipped" : "saved");
			badge.title = `Question ${i + 1}: ${isSkipped ? "Skipped" : "Completed"}`;
		} else if (i === session.index) {
			badge.classList.add("active");
			badge.title = "Current Question";
		}

		container.appendChild(badge);
	});
}

function renderImages(q) {
	const area = document.getElementById("imageArea");
	area.innerHTML = "";
	(q.images || []).forEach((src) => {
		const img = document.createElement("img");
		img.src = src;
		img.style.maxWidth = "100%";
		img.style.minWidth = "500px";
		img.style.margin = "10px";
		img.style.align = "center";
		img.style.margin = "auto";
		area.appendChild(img);
	});
}

function finish() {
	session.finished = true;
	saveSession(session);

	// Add the class that fixes the scrolling/cutting off issue
	document
		.querySelector(".content-center")
		.classList.add("screen-results-active");

	buildResults();
	show("results");
}

function buildResults() {
	const list = document.getElementById("reviewList");
	list.innerHTML = "";

	QUESTIONS.forEach((q, i) => {
		const audioUrl = session.recordings[i];
		const transcript = session.transcripts[i];

		const div = document.createElement("div");
		div.className = "review";
		div.innerHTML = `
            <h3 style="border-bottom: 1px solid #ddd; padding-bottom: 5px;">${q.part}</h3>
            <p><strong>Question:</strong> ${q.text}</p> 
            ${audioUrl ? `<audio controls src="${audioUrl}"></audio>` : `<p style="color: gray;">(No recording)</p>`}
            <div style="margin-top: 10px; padding: 10px; ; border-left: 4px solid #4caf50; border-top: 1px solid #09661a74; border-bottom: 1px solid #09661a74; text-align: left; border-radius: 4px; background: #f9f9f90f;">
                <strong>Your Answer:</strong><br>
                <span style="font-style: italic; ">${transcript || "No transcript available."}</span>
            </div>
        `;
		list.appendChild(div);
	});
}

/* ---------- EVENTS ---------- */

skipBtn.onclick = () => {
	skip = true;
	speechSynthesis.cancel();
	if (mediaRecorder && mediaRecorder.state === "recording")
		mediaRecorder.stop();
	if (recognition) recognition.stop();
	if (resolveCurrentStep) resolveCurrentStep();
};

/* ---------- SESSION RESUME LOGIC ---------- */

const continueBtn = document.getElementById("continueBtn");
const startBtn = document.getElementById("startBtn");

if (session.index > 0 && !session.finished) {
	continueBtn.style.display = "block";
	startBtn.textContent = "Start New Test";
	startBtn.classList.replace("btn-primary", "btn-outline");
	updateBadges(); // Show progress even on intro screen
}

startBtn.onclick = async () => {
	if (session.index > 0 && !session.finished) {
		if (!confirm("Start over? Your current recordings will be deleted."))
			return;
		clearSession();
		session = newSession("A");
	}
	await startTest();
};

continueBtn.onclick = startTest;
document.getElementById("restartBtn").onclick = () => {
	document
		.querySelector(".content-center")
		.classList.remove("screen-results-active");
	clearSession();
	location.reload();
};

document.getElementById("versionBtn").onclick = () => {
	let nextVer;
	if (session.version === "A") nextVer = "B";
	else if (session.version === "B") nextVer = "C";
	else nextVer = "A"; // Loop back to A

	if (
		confirm(`Switch to Version ${nextVer}? This will clear current progress.`)
	) {
		clearSession();
		saveSession(newSession(nextVer));
		location.reload();
	}
};

const versionBtn = document.getElementById("versionBtn");
if (versionBtn) {
	let nextVer =
		session.version === "A" ? "B" : session.version === "B" ? "C" : "A";
	versionBtn.textContent = `Switch to Version ${nextVer}`;
}

// Handle existing session
if (session.finished) {
	buildResults();
	show("results");
} else if (session.index > 0) {
	// If user refreshed mid-test, don't auto-start, but show intro to trigger unlockAudio
	show("intro");
}

// Theme Logic
const themeBtn = document.getElementById("themeToggle");
const savedTheme = localStorage.getItem("theme") || "light";

// Apply saved theme on load
if (savedTheme === "dark") {
	document.body.setAttribute("data-theme", "dark");
	if (themeBtn) themeBtn.textContent = "☀️ Light Mode";
}

if (themeBtn) {
	themeBtn.onclick = () => {
		const isDark = document.body.hasAttribute("data-theme");
		if (isDark) {
			document.body.removeAttribute("data-theme");
			themeBtn.textContent = "🌙 Dark Mode";
			localStorage.setItem("theme", "light");
		} else {
			document.body.setAttribute("data-theme", "dark");
			themeBtn.textContent = "☀️ Light Mode";
			localStorage.setItem("theme", "dark");
		}
	};
}

function updateVersionUI() {
	// Remove active class from all
	document
		.querySelectorAll(".ver-btn")
		.forEach((btn) => btn.classList.remove("active"));
	// Add to current
	const activeBtn = document.getElementById(`btnVer${session.version}`);
	if (activeBtn) activeBtn.classList.add("active");
}

window.switchVersion = function (ver) {
	if (session.version === ver) return;

	if (
		confirm(
			`Switch to Version ${ver}? This will restart your current progress.`,
		)
	) {
		clearSession();
		session = newSession(ver);
		saveSession(session);
		location.reload();
	}
};

// Call this on page load
updateVersionUI();
