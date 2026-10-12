const status = document.querySelector("#app-status");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js");
  });
}

status.textContent = "Die neue App-Struktur ist eingerichtet und offlinefähig vorbereitet.";
