const CACHE_NAME = "bcts-v1";
const ASSETS = [
	"./",
	"./index.html",
	"./style.css",
	"./app.js",
	"./questions.js",
	"./manifest.json",
	// Icons
	"./images/icon-192.png",
	"./images/icon-512.png",
	// Test Images - Make sure these match your actual filenames exactly!
	"./images/A-Image2.png",
	"./images/A-Image3.png",
	"./images/A-Image4.png",
	"./images/B-Image2.jpg",
	"./images/B-Image3.jpg",
	"./images/B-Image4.png",
	"./images/C-Image2.png",
	"./images/C-Image3.png",
	"./images/C-Image4.jpg",
];

self.addEventListener("install", (e) => {
	e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
});

self.addEventListener("fetch", (e) => {
	e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
});
