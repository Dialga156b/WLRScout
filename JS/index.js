import { TBA_GET, getUserTeam, isActiveEvent, newEventCache } from "./utils.js";

const userProfile = JSON.parse(localStorage.getItem("userProfile")) || {};

const urlParams = new URLSearchParams(window.location.search);
const setupBtn = document.getElementById("setupBtn");
const adminBtn = document.getElementById("adminBtn");

const msg = urlParams.get("msg");
const debugID = urlParams.get("dbID") || null;
if (msg) {
  const msgBox = document.getElementById("errMsg");
  msgBox.textContent = decodeURIComponent(msg);
  msgBox.classList.remove("hidden");
}

const eventBtn = document.getElementById("eventBtn");
eventBtn.classList.add("eventBtn");

if (userProfile.role == "admin") {
  //worst way of doing this ever. literally no other auth checks. just this. TODO FIXX!!!!
  adminBtn.classList.remove("hidden");
}

var validEvent = false;
var nextValidEvent = null;
//hemmy boy!!!!

async function reload() {
  const { isActive, event } = await isActiveEvent(debugID); // horrendous naming

  if (isActive) {
    console.log(event);
    eventBtn.classList.add("validEvent");
    eventBtn.innerText = `${event.name} →`;
    validEvent = event;
  } else {
    eventBtn.classList.add("noEvent");
    eventBtn.innerText = "[ No Current Event ]";

    nextValidEvent = event;

    // just thought this looked cool
    let showBrackets = false;
    setInterval(() => {
      eventBtn.innerText = showBrackets ? "[ No Current Event ]" : "No Current Event";
      showBrackets = !showBrackets;
    }, 1000);
  }
}

eventBtn.addEventListener("click", () => {
  // add admin features + secure identification in cloudflare worker later
  if (validEvent) {
    const uProfile = JSON.parse(localStorage.getItem("userProfile")) || null;
    if (uProfile && uProfile.name) {
      window.location = `../HTML/event-frc.html?eventKey=${validEvent.key}`;
    } else {
      window.location = `../HTML/profiles.html?eventKey=${validEvent.key}`;
    }
  } else {
    const errorMsg = document.getElementById("errMsg");
    const nextDate = nextValidEvent ? new Date(nextValidEvent?.start_date).toDateString() : null;
    errorMsg.textContent = `Event scouting won't resume until ${nextDate || "the OCCRA season"}, at ${nextValidEvent?.location_name || "who knows where"}. See you ${nextDate ? "there" : "then"}!`;
    errorMsg.classList.remove("hidden");
  }
});

setupBtn.addEventListener("click", () => {
  setupBtn.disabled = true;
  console.log(validEvent);
  setupBtn.innerHTML = `<ion-icon class="ionicon" name="cloud-download-outline"></ion-icon> Please Wait...`;
  location.href = `/HTML/scout.html?eventKey=${validEvent.key}&setupComplete=true`;
});

async function toggleDebug() {
  const now = new Date();
  const year = now.getFullYear();

  for (const y of [year, year - 1]) {
    const eventsRaw = Object.entries(localStorage);
    const events = eventsRaw.filter(([key]) => key.startsWith("eventCache_")).map(([key, value]) => JSON.parse(value));
    events.sort((a, b) => new Date(b.eventDetails.end_date) - new Date(a.eventDetails.end_date));
    console.log(events[0]);
    if (events.length) {
      location.href = location.pathname + `?dbID=${events[0].eventDetails.key}`;
      return;
    }
  }

  alert("Couldn't find a past event to debug with!!!!! This button only works if you've viewed another event on the app before");
}

reload();
window.toggleDebug = toggleDebug;
