import { newEvent, getEvents, getEvent, updateEvent as saveEventChanges, deleteEvent } from "../DB.js";
import { TBA_GET, getUserTeam } from "../utils.js";

const newEventBtn = document.getElementById("new-event-btn");
const formContainer = document.getElementById("form");
const eventsContainer = document.getElementById("events");
const firstList = document.getElementById("events-first");
const occraList = document.getElementById("events-occra");
const occraStatus = document.getElementById("events-occra-status");
const eventBtnTemplate = document.getElementById("event-btn-template");

const formName = document.getElementById("event-name");
const formStart = document.getElementById("event-start-date");
const formEnd = document.getElementById("event-end-date");
const formLocation = document.getElementById("event-location");
const formAllianceSizeBtn = document.getElementById("event-alliance-size-btn");

const readoutName = document.getElementById("ro-name");
const readoutKey = document.getElementById("ro-key");
const readoutDur = document.getElementById("ro-duration");

const cancelBtn = document.getElementById("cancel-creation-btn");
const createBtn = document.getElementById("create-btn");

const scheduleEditor = document.getElementById("schedule-editor");
const scheduleSubheader = document.getElementById("schedule-subheader");
const addMatchBtn = document.getElementById("add-match-btn");
const deleteLastBtn = document.getElementById("delete-last-btn");
const scheduleBackBtn = document.getElementById("schedule-back-btn");
const saveScheduleBtn = document.getElementById("save-schedule-btn");
const deleteEventBtn = document.getElementById("delete-event-btn");
const scheduleAllianceSizeBtn = document.getElementById("schedule-alliance-size-btn");
const scheduleTable = document.getElementById("schedule-table");

const header = document.getElementById("header");

const tbody = document.getElementById("scouters-tbody");
const rowTemplate = document.getElementById("scouter-row-template");

const DAY_MS = 1000 * 60 * 60 * 24;
const REQUIRED_FIELDS = { name: "Event name", short_name: "Short name", start_date: "Start date", end_date: "End date", location_name: "Location" };

let customEvents = []; // OCCRA events from the worker
let activeEvent = null; // event whose schedule is open
let matches = [];
var draftEvent = {};
let formTeamsPerAlliance = 3;

// events made before this setting existed (and every TBA event) are 3v3
const teamsPerAlliance = (ev) => (ev?.teams_per_alliance === 2 ? 2 : 3);

function setAllianceSizeLabel(btn, size) {
  btn.querySelector(".alliance-size-label").textContent = `${size} Teams / Alliance`;
}

localStorage.removeItem("manageEventsSchedule"); // old global schedule, now stored per event

function showView(view) {
  eventsContainer.style.display = view === "list" ? "flex" : "none";
  newEventBtn.style.display = view === "list" ? "flex" : "none";
  formContainer.style.display = view === "form" ? "flex" : "none";
  scheduleEditor.classList.toggle("hidden", view !== "schedule");

  if (view === "list") header.textContent = "Events";
  if (view === "form") header.textContent = "New Event";
  if (view === "schedule") header.textContent = activeEvent?.name || "Schedule";
}

function formatDates(ev) {
  const opts = { month: "short", day: "numeric" };
  const start = new Date(`${ev.start_date}T00:00:00`).toLocaleDateString(undefined, opts);
  const end = new Date(`${ev.end_date}T00:00:00`).toLocaleDateString(undefined, opts);
  return start === end ? start : `${start} - ${end}`;
}

function createEventButton(ev, subText, icon) {
  const btn = eventBtnTemplate.cloneNode(true);
  btn.removeAttribute("id");
  btn.classList.remove("hidden");
  btn.querySelector(".eb-name").textContent = ev.name;
  btn.querySelector(".eb-sub").textContent = subText;
  btn.querySelector(".eb-icon").setAttribute("name", icon);
  return btn;
}

// ---------- event lists ----------

async function loadEvents() {
  occraList.querySelectorAll(".event-btn").forEach((el) => el.remove());
  occraStatus.textContent = "Loading...";
  occraStatus.classList.remove("hidden");

  try {
    customEvents = await getEvents();
    if (!Array.isArray(customEvents)) customEvents = [];
  } catch (err) {
    console.error("Failed to load events:", err);
    customEvents = [];
    occraStatus.textContent = "Couldn't load events.";
    return;
  }

  customEvents.sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
  customEvents.forEach((ev) => {
    const hasSchedule = ev.matches?.length > 0;
    const size = teamsPerAlliance(ev);
    const subText = hasSchedule ? `${formatDates(ev)} | ${ev.matches.length} matches | ${size}v${size}` : "! UNSET SCHEDULE !!! TAP TO ADD !";
    const btn = createEventButton(ev, subText, hasSchedule ? "calendar" : "alert-circle");
    if (!hasSchedule) btn.classList.add("striped-bg-img");
    btn.addEventListener("click", () => openSchedule(ev.key));
    occraList.appendChild(btn);
  });

  occraStatus.textContent = "No OCCRA events yet.";
  occraStatus.classList.toggle("hidden", customEvents.length > 0);
}

// FIRST events come from TBA and are read-only here
async function loadFirstEvents() {
  const events = await TBA_GET(`/team/frc${getUserTeam()}/events/${new Date().getFullYear()}`);
  if (!Array.isArray(events)) return;
  events
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .forEach((ev) => {
      const btn = createEventButton(ev, formatDates(ev), "trophy");
      btn.style.cursor = "default";
      firstList.appendChild(btn);
    });
}

// ---------- new event form ----------

function uniqueEventKey(year, shortName) {
  const slug = shortName.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3) || "evt";
  const base = `${year}wlros-${slug}`;
  let key = base;
  for (let n = 2; customEvents.some((ev) => ev.key === key); n++) key = `${base}${n}`;
  return key;
}

// returns the event's length in days (inclusive), 0 if the dates are missing/backwards
function readForm() {
  const year = formStart.value.slice(0, 4) || String(new Date().getFullYear());
  // "2026 OCCRA Oxford Event" -> "Oxford"
  const shortName = formName.value
    .trim()
    .replace(/^\d{4}\s+/, "")
    .replace(/^OCCRA\s+/i, "")
    .replace(/\s+Event$/i, "")
    .trim();

  draftEvent = {
    key: shortName ? uniqueEventKey(year, shortName) : "",
    name: formName.value.trim(),
    short_name: shortName,
    year: Number(year),
    start_date: formStart.value,
    end_date: formEnd.value,
    location_name: formLocation.value.trim(),
    event_type_string: "Offseason",
    district: { abbreviation: "occra", display_name: "OCCRA" },
    teams_per_alliance: formTeamsPerAlliance,
    matches: [],
  };

  let durationDays = 0;
  if (formStart.value && formEnd.value) {
    durationDays = Math.round((Date.parse(formEnd.value) - Date.parse(formStart.value)) / DAY_MS) + 1;
    if (durationDays < 1) durationDays = 0;
  }

  readoutName.textContent = shortName || "-";
  readoutKey.textContent = draftEvent.key || "-";
  readoutDur.textContent = durationDays ? `${durationDays} Day${durationDays === 1 ? "" : "s"}` : "INVALID";
  return durationDays;
}

function resetForm() {
  [formName, formStart, formEnd, formLocation].forEach((input) => (input.value = ""));
  formTeamsPerAlliance = 3;
  setAllianceSizeLabel(formAllianceSizeBtn, formTeamsPerAlliance);
  readForm();
}

formAllianceSizeBtn.addEventListener("click", () => {
  formTeamsPerAlliance = formTeamsPerAlliance === 3 ? 2 : 3;
  setAllianceSizeLabel(formAllianceSizeBtn, formTeamsPerAlliance);
  readForm();
});

newEventBtn.addEventListener("click", () => {
  readForm();
  showView("form");
});

cancelBtn.addEventListener("click", () => showView("list"));

createBtn.addEventListener("click", async () => {
  const durationDays = readForm();
  const missing = Object.keys(REQUIRED_FIELDS).filter((field) => !draftEvent[field]);
  if (missing.length) {
    alert(`Event not created. Missing: ${missing.map((field) => REQUIRED_FIELDS[field]).join(", ")}`);
    return;
  }
  if (!durationDays) {
    alert("Event not created. The end date must be on or after the start date.");
    return;
  }

  createBtn.disabled = true;
  try {
    const res = await newEvent(draftEvent);
    if (!res?.success) throw new Error(res?.error || "the server rejected the event");
    const key = res.eventKey || draftEvent.key;
    resetForm();
    await loadEvents();
    await openSchedule(key);
  } catch (err) {
    console.error("Failed to create event:", err);
    alert(`Event not created: ${err.message}`);
  } finally {
    createBtn.disabled = false;
  }
});

[formName, formStart, formEnd, formLocation].forEach((input) => input.addEventListener("input", readForm));

let TEMPLATE_FULL = [
  {
    actual_time: 1774709572,
    alliances: {
      blue: {
        dq_team_keys: [],
        score: 595,
        surrogate_team_keys: [],
        team_keys: ["frc5460", "frc3322", "frc1506"],
      },
      red: {
        dq_team_keys: [],
        score: 78,
        surrogate_team_keys: [],
        team_keys: ["frc4994", "frc3604", "frc11455"],
      },
    },
    comp_level: "qm",
    event_key: "2026misal",
    key: "2026misal_qm1",
    match_number: 1,
    post_result_time: 1774709766,
    predicted_time: 1774710000,
    score_breakdown: {
      blue: {
        adjustPoints: 0,
        autoTowerPoints: 0,
        autoTowerRobot1: "None",
        autoTowerRobot2: "None",
        autoTowerRobot3: "None",
        endGameTowerPoints: 10,
        endGameTowerRobot1: "None",
        endGameTowerRobot2: "Level1",
        endGameTowerRobot3: "None",
        energizedAchieved: true,
        foulPoints: 0,
        g206Penalty: false,
        hubScore: {
          autoCount: 46,
          autoPoints: 46,
          endgameCount: 137,
          endgamePoints: 137,
          shift1Count: 0,
          shift1Points: 0,
          shift2Count: 172,
          shift2Points: 172,
          shift3Count: 0,
          shift3Points: 0,
          shift4Count: 181,
          shift4Points: 181,
          teleopCount: 539,
          teleopPoints: 539,
          totalCount: 585,
          totalPoints: 585,
          transitionCount: 49,
          transitionPoints: 49,
          uncounted: 4,
        },
        majorFoulCount: 0,
        minorFoulCount: 0,
        penalties: "None",
        rp: 5,
        superchargedAchieved: true,
        totalAutoPoints: 46,
        totalPoints: 595,
        totalTeleopPoints: 549,
        totalTowerPoints: 10,
        traversalAchieved: false,
      },
      red: {
        adjustPoints: 0,
        autoTowerPoints: 0,
        autoTowerRobot1: "None",
        autoTowerRobot2: "None",
        autoTowerRobot3: "None",
        endGameTowerPoints: 0,
        endGameTowerRobot1: "None",
        endGameTowerRobot2: "None",
        endGameTowerRobot3: "None",
        energizedAchieved: false,
        foulPoints: 0,
        g206Penalty: false,
        hubScore: {
          autoCount: 31,
          autoPoints: 31,
          endgameCount: 0,
          endgamePoints: 0,
          shift1Count: 20,
          shift1Points: 20,
          shift2Count: 0,
          shift2Points: 0,
          shift3Count: 26,
          shift3Points: 26,
          shift4Count: 0,
          shift4Points: 0,
          teleopCount: 47,
          teleopPoints: 47,
          totalCount: 78,
          totalPoints: 78,
          transitionCount: 1,
          transitionPoints: 1,
          uncounted: 0,
        },
        majorFoulCount: 0,
        minorFoulCount: 0,
        penalties: "None",
        rp: 0,
        superchargedAchieved: false,
        totalAutoPoints: 31,
        totalPoints: 78,
        totalTeleopPoints: 47,
        totalTowerPoints: 0,
        traversalAchieved: false,
      },
    },
    time: 1774710000,
    winning_alliance: "blue",
  },
];

let match_template = [
  {
    alliances: {
      blue: {
        score: -7,
        team_keys: ["frc0", "frc1", "frc12345"],
      },
      red: {
        score: -7,
        team_keys: ["frc0", "frc1", "frc456789"],
      },
    },
    key: "2026misal_qm1",
    match_number: 1,
    winning_alliance: "blue",
  },
];

// ---------- schedule editor ----------

const draftKey = (eventKey) => `scheduleDraft_${eventKey}`;

// New rows follow match_template's shape: no score yet (-1, TBA's "unplayed"
// value that event-frc checks for), no winner yet.
function createMatch(matchNumber) {
  const size = teamsPerAlliance(activeEvent);
  return {
    alliances: {
      blue: { score: -1, team_keys: Array(size).fill("") },
      red: { score: -1, team_keys: Array(size).fill("") },
    },
    comp_level: "qm",
    event_key: activeEvent.key,
    key: `${activeEvent.key}_qm${matchNumber}`,
    match_number: matchNumber,
    set_number: 1,
    winning_alliance: null,
  };
}

// keeps numbering/keys and alliance sizes in sync after rows are added or removed
function normalizeMatches() {
  const size = teamsPerAlliance(activeEvent);
  matches.forEach((match, index) => {
    for (const alliance of ["blue", "red"]) {
      const keys = match.alliances[alliance].team_keys;
      match.alliances[alliance].team_keys = Array.from({ length: size }, (_, i) => keys[i] || "");
    }
    match.match_number = index + 1;
    match.comp_level ??= "qm";
    match.set_number ??= 1;
    match.event_key = activeEvent.key;
    match.key = `${activeEvent.key}_${match.comp_level}${match.match_number}`;
  });
}

function saveDraft() {
  localStorage.setItem(draftKey(activeEvent.key), JSON.stringify({ teams_per_alliance: teamsPerAlliance(activeEvent), matches }));
}

// older drafts are just the matches array
function loadDraft(eventKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(draftKey(eventKey)));
    if (Array.isArray(stored)) return { matches: stored };
    if (Array.isArray(stored?.matches)) return stored;
  } catch {}
  return null;
}

async function openSchedule(eventKey) {
  try {
    activeEvent = await getEvent(eventKey);
  } catch (err) {
    console.error("Failed to load event:", err);
    alert(`Couldn't load ${eventKey}: ${err.message}`);
    return;
  }

  const saved = activeEvent.matches || [];
  const draft = loadDraft(eventKey);
  const draftChanged = draft && (JSON.stringify(draft.matches) !== JSON.stringify(saved) || (draft.teams_per_alliance && draft.teams_per_alliance !== teamsPerAlliance(activeEvent)));
  const restoreDraft = draftChanged && confirm("This event has unsaved schedule changes on this device. Restore them?");
  matches = restoreDraft ? draft.matches : structuredClone(saved);
  if (restoreDraft && draft.teams_per_alliance) activeEvent.teams_per_alliance = draft.teams_per_alliance;
  if (!restoreDraft) localStorage.removeItem(draftKey(eventKey));
  if (!matches.length) matches.push(createMatch(1));

  scheduleSubheader.textContent = `${activeEvent.key} | ${activeEvent.location_name} | ${formatDates(activeEvent)}`;
  renderRows();
  showView("schedule");
}

function teamNumberFromKey(key) {
  return (key || "").replace(/^frc/, "");
}
function teamKeyFromNumber(number) {
  const trimmed = (number || "").trim();
  return trimmed ? `frc${trimmed}` : "";
}

const ALLIANCE_CELLS = [
  [".r-blue1", "blue", 0],
  [".r-blue2", "blue", 1],
  [".r-blue3", "blue", 2],
  [".r-red1", "red", 0],
  [".r-red2", "red", 1],
  [".r-red3", "red", 2],
];

// slot 3 cells are hidden (and skipped) for 2v2 events
const activeCells = () => ALLIANCE_CELLS.filter(([, , slot]) => slot < teamsPerAlliance(activeEvent));

function renderRows() {
  normalizeMatches();
  const size = teamsPerAlliance(activeEvent);
  scheduleTable.classList.toggle("two-per-alliance", size === 2);
  setAllianceSizeLabel(scheduleAllianceSizeBtn, size);
  tbody.querySelectorAll("tr:not(#scouter-row-template)").forEach((row) => row.remove());
  matches.forEach((match) => {
    const row = rowTemplate.cloneNode(true);
    row.removeAttribute("id");
    row.classList.remove("hidden");

    row.querySelector(".r-round-num").textContent = match.match_number;

    activeCells().forEach(([selector, alliance, slot]) => {
      const input = row.querySelector(`${selector} input`);
      input.value = teamNumberFromKey(match.alliances[alliance].team_keys[slot]);
      input.addEventListener("input", () => {
        input.value = input.value.replace(/\D/g, ""); // team numbers only
        input.classList.remove("invalid");
        match.alliances[alliance].team_keys[slot] = teamKeyFromNumber(input.value);
        saveDraft();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key !== " ") return;
        e.preventDefault();
        const inputs = Array.from(tbody.querySelectorAll(".team-input")).filter((el) => el.offsetParent); // skip hidden 3rd slots
        const next = inputs[inputs.indexOf(input) + 1];
        if (next) {
          next.focus();
          next.select();
        }
      });
    });

    row.querySelector(".row-delete-btn").addEventListener("click", () => {
      match.alliances.blue.team_keys = Array(size).fill("");
      match.alliances.red.team_keys = Array(size).fill("");
      saveDraft();
      renderRows();
    });

    tbody.appendChild(row);
  });
}

// highlights bad cells; errors block saving, emptyMatches only warn
function validateSchedule() {
  const rows = tbody.querySelectorAll("tr:not(#scouter-row-template)");
  const errors = [];
  const emptyMatches = [];

  matches.forEach((match, index) => {
    const cells = activeCells();
    const inputs = cells.map(([selector]) => rows[index].querySelector(`${selector} input`));
    const teams = cells.map(([, alliance, slot]) => match.alliances[alliance].team_keys[slot]);

    if (teams.some((team) => !team)) emptyMatches.push(match.match_number);
    teams.forEach((team, i) => {
      const first = teams.indexOf(team);
      if (team && first !== i) {
        inputs[i].classList.add("invalid");
        inputs[first].classList.add("invalid");
        errors.push(`Match ${match.match_number} has team ${teamNumberFromKey(team)} more than once`);
      }
    });
  });
  return { errors, emptyMatches };
}

scheduleAllianceSizeBtn.addEventListener("click", () => {
  const next = teamsPerAlliance(activeEvent) === 3 ? 2 : 3;
  const filledSlot3 = matches.filter((m) => m.alliances.blue.team_keys[2] || m.alliances.red.team_keys[2]).map((m) => m.match_number);
  if (next === 2 && filledSlot3.length && !confirm(`Switching to 2 teams per alliance clears Blue 3 / Red 3 in match${filledSlot3.length === 1 ? "" : "es"} ${filledSlot3.join(", ")}. Continue?`)) return;
  activeEvent.teams_per_alliance = next;
  renderRows(); // resizes every match's team_keys
  saveDraft();
});

addMatchBtn.addEventListener("click", () => {
  matches.push(createMatch(matches.length + 1));
  saveDraft();
  renderRows();
});

deleteLastBtn.addEventListener("click", () => {
  if (!matches.length) return;
  matches.pop();
  saveDraft();
  renderRows();
});

scheduleBackBtn.addEventListener("click", () => {
  activeEvent = null;
  showView("list");
});

saveScheduleBtn.addEventListener("click", async () => {
  const { errors, emptyMatches } = validateSchedule();
  if (errors.length) {
    alert(`Schedule not saved:\n- ${errors.join("\n- ")}`);
    return;
  }
  if (emptyMatches.length && !confirm(`Match${emptyMatches.length === 1 ? "" : "es"} ${emptyMatches.join(", ")} still have empty slots. Save anyway?`)) return;

  normalizeMatches();
  saveScheduleBtn.disabled = true;
  try {
    await saveEventChanges(activeEvent.key, { teams_per_alliance: teamsPerAlliance(activeEvent), matches });
    activeEvent.matches = structuredClone(matches);
    localStorage.removeItem(draftKey(activeEvent.key));
    alert(`Saved ${matches.length} matches for ${activeEvent.name}.`);
    loadEvents();
  } catch (err) {
    console.error("Failed to save schedule:", err);
    alert(`Schedule not saved: ${err.message}\nYour changes are kept on this device.`);
  } finally {
    saveScheduleBtn.disabled = false;
  }
});

deleteEventBtn.addEventListener("click", async () => {
  if (!confirm(`Delete ${activeEvent.name} (${activeEvent.key}) and its schedule? This can't be undone.`)) return;
  deleteEventBtn.disabled = true;
  try {
    await deleteEvent(activeEvent.key);
    localStorage.removeItem(draftKey(activeEvent.key));
    activeEvent = null;
    showView("list");
    loadEvents();
  } catch (err) {
    console.error("Failed to delete event:", err);
    alert(`Event not deleted: ${err.message}`);
  } finally {
    deleteEventBtn.disabled = false;
  }
});

showView("list");
readForm();
loadEvents();
loadFirstEvents();
