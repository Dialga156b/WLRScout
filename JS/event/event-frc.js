import { newEventCache, isCustomEventKey, getEstimatedMatchResults } from "../utils.js";
import { loadLeaderboard } from "./leaderboard.js";
import { questionDB } from "../DB.js";
const eventNameHeader = document.getElementById("eventNameHeader");
const slot = document.getElementById("slot-text");
const eventCodeHeader = document.getElementById("eventCodeHeader");
const urlParams = new URLSearchParams(window.location.search);
const offlineScoutBtn = document.getElementById("btn-offline");
const loadingOverlay = document.getElementById("loading-overlay");
const nextPageBtn = document.getElementById("nextPageBtn");
const bodyLeft = document.querySelector(".body-left");
const bodyRight = document.querySelector(".body-right");

const noDice = document.querySelector(".noInfoPopup");
const scrollBtn = document.querySelector(".scroll-btn");

var inspectedMatch = null;
const eventKey = urlParams.get("eventKey") || null;
var currentPage = "R";

const CACHE_KEY = `eventCache_${eventKey}`;
localStorage.setItem("currentEventKey", eventKey);

async function renderMatches(mData, scoutedData) {
  const dividerEl = document.querySelector("#ls-divider");
  const matchtemplate = document.getElementById("ml-template");
  var lastMatchType = "";
  var lastMatchCompleted = false;

  var delay = 0;

  // OCCRA has no real scores, so scores + per-team points get estimated from scouting (OCCRA_POINT_VALUES in utils)
  const estimatedResults = isCustomEventKey(eventKey) ? getEstimatedMatchResults(mData, scoutedData) : new Map();

  for (const match of mData) {
    const matchEl = matchtemplate.cloneNode(true);
    const estimated = estimatedResults.get(match.key);
    const matchIdEl = matchEl.querySelector("#match-id");

    // dividers for quals, semis, finals
    if (match.comp_level !== lastMatchType) {
      const thisDivider = dividerEl.cloneNode(true);
      if (match.comp_level === "qm") {
        thisDivider.textContent = "- Qualifiers -";
      } else if (match.comp_level === "sf") {
        thisDivider.textContent = "- Semifinals -";
      } else if (match.comp_level === "f") {
        thisDivider.textContent = "- Finals -";
      }
      thisDivider.classList.remove("hidden");
      dividerEl.parentNode.appendChild(thisDivider);
      lastMatchType = match.comp_level;
    }

    // concat a 0 before numbers less than 10 (03)
    var matchNum = match.match_number;
    if (match.comp_level === "sf") {
      matchNum = match.set_number;
    }
    matchIdEl.textContent = matchNum < 10 ? `0${matchNum}` : matchNum;

    // TBA matches are 3v3, OCCRA events can be 2v2 (teams_per_alliance) BUT IDK IF THEYLL CHANGE IT NEXT SEASON!!
    const teamsPerAlliance = Math.max(match.alliances.blue.team_keys.length, match.alliances.red.team_keys.length);
    for (let i = 0; i < 3; i++) {
      const blueTeamEl = matchEl.querySelector("#m-blue").querySelector(`#team${i + 1}`);
      const redTeamEl = matchEl.querySelector("#m-red").querySelector(`#team${i + 1}`);

      if (i >= teamsPerAlliance) {
        blueTeamEl.remove();
        redTeamEl.remove();
        continue;
      }
      for (const [teamEl, teamKey] of [
        [blueTeamEl, match.alliances.blue.team_keys[i] || ""],
        [redTeamEl, match.alliances.red.team_keys[i] || ""],
      ]) {
        teamEl.textContent = teamKey.slice(3);
        teamEl.dataset.team = teamKey.slice(3); // search reads this so domnt remove
        const points = estimated?.teamPoints[teamKey];
        if (points !== undefined) {
          const pointsEl = document.createElement("span");
          pointsEl.className = "team-pts";
          //pointsEl.display = "none";
          pointsEl.textContent = `${Math.round(points)} pts`;
          teamEl.appendChild(pointsEl);
        }
      }
    }
    matchEl.classList.toggle("two-per-alliance", teamsPerAlliance === 2);

    const redScoreEl = matchEl.querySelector("#match-red-score");
    const blueScoreEl = matchEl.querySelector("#match-blue-score");

    if (estimated) {
      // "~" since these are estimates from scouting, not real scores
      redScoreEl.textContent = `~${Math.round(estimated.red)}`;
      blueScoreEl.textContent = `~${Math.round(estimated.blue)}`;
    } else {
      redScoreEl.textContent = `${match.alliances.red.score === (-1 || null) ? "-" : match.alliances.red.score}`;
      blueScoreEl.textContent = `${match.alliances.blue.score === (-1 || null) ? "-" : match.alliances.blue.score}`;
    }

    const hasScores = match.alliances.red.score !== -1 && match.alliances.blue.score !== -1;
    // _scouted: OCCRA matches count as played once scouted, see markScoutedMatches in utils
    const isCompleted = match._scouted || hasScores;
    const winningAlliance = estimated ? estimated.winner : match.winning_alliance;

    if (isCompleted) {
      matchEl.querySelector("#match-status").setAttribute("name", "cloud-done-outline");
    } else {
      if (lastMatchCompleted) {
        matchEl.classList.add("match-theme-active");
        matchEl.querySelector("#match-status").setAttribute("name", "play-circle-outline");
      } else {
        matchEl.querySelector("#match-status").setAttribute("name", "hourglass-outline");
      }
    }

    if (winningAlliance === "blue") {
      matchEl.classList.add("theme-blue-victory");
      blueScoreEl.classList.add("winner");
    } else if (winningAlliance === "red") {
      matchEl.classList.add("theme-red-victory");
      redScoreEl.classList.add("winner");
    } else {
      matchEl.classList.add("theme-tie");
    }

    // a match that's been scouted but has no scores is still being scouted by the others, so offer both
    const actions = [];
    if (isCompleted) actions.push({ label: "Review this match", short: "Review", href: `/HTML/inspect.html?type=match&key=${match.key}` });
    if (!hasScores) actions.push({ label: "Scout This Match", short: "Scout", href: `../HTML/scout.html?eventKey=${eventKey}&matchKey=${match.key}` });

    const actionBtn = matchEl.querySelector("#action-btn");
    let actionBtns = [actionBtn];
    if (actions.length > 1) {
      const group = document.createElement("div");
      group.className = "action-group";
      actionBtn.replaceWith(group);
      actionBtns = actions.map(() => {
        const btn = actionBtn.cloneNode(true);
        btn.removeAttribute("id");
        group.appendChild(btn);
        return btn;
      });
    }

    actionBtns.forEach((btn, i) => {
      const { label, short, href } = actions[i];
      btn.innerHTML = `
        <ion-icon class="ionicon" name="open-outline"></ion-icon> ${actions.length > 1 ? short : label}`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!btn.classList.contains("hidden")) location.href = href;
      });
    });

    //inspection toggle
    matchEl.addEventListener("click", () => {
      if (inspectedMatch && inspectedMatch.key !== match.key) {
        const prevInspectedEl = document.getElementById(`match-${inspectedMatch.key}`);
        prevInspectedEl.querySelector("#teams-table").classList.remove("overlapped");

        prevInspectedEl.querySelectorAll(".action-btn").forEach((btn) => btn.classList.add("hidden"));
      }
      actionBtns.forEach((btn) => btn.classList.toggle("hidden"));
      matchEl.querySelector("#teams-table").classList.toggle("overlapped");
      inspectedMatch = match;
    });

    lastMatchCompleted = isCompleted;
    matchEl.id = `match-${match.key}`;
    matchtemplate.parentNode.appendChild(matchEl);
  }
  matchtemplate.classList.add("hidden"); // dont delete for refreshing w/o fetches
}

function nextPage() {
  if (currentPage == "R") {
    currentPage = "L";
    bodyRight.style.display = "none";
    bodyLeft.style.display = "flex";
    nextPageBtn.innerHTML = `<ion-icon name="game-controller-outline" role="img" class="md hydrated"></ion-icon>`;
  } else {
    currentPage = "R";
    bodyRight.style.display = "flex";
    bodyLeft.style.display = "none";
    nextPageBtn.innerHTML = `<ion-icon name="trophy-outline" role="img" class="md hydrated"></ion-icon>`;
  }
}

nextPageBtn.addEventListener("click", nextPage);

document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    if (!eventKey) {
      location.href = "index.html";
      return;
    }

    const cachedBundle = localStorage.getItem(CACHE_KEY);

    let mData, eventDetails, scoutedData;

    if (cachedBundle) {
      console.log("Using cached event bundle");
      ({ mData, eventDetails, scoutedData } = JSON.parse(cachedBundle));
    } else {
      console.log("No cached data, fetching from TBA");
      ({ mData, eventDetails, scoutedData } = await newEventCache(eventKey, () => questionDB("GET")));
    }
    const eventName = `${eventDetails.year} ${eventDetails.district?.abbreviation?.toUpperCase() || eventDetails.short_name} ${eventDetails.short_name} Event`;
    eventNameHeader.textContent = eventName;
    eventCodeHeader.textContent = eventKey || "Event Code";

    const userData = JSON.parse(localStorage.getItem("userProfile"));
    if (userData.matches && userData.matches.slot) {
      slot.textContent = userData.slot;
    } else {
      slot.textContent = "No Position";
    }

    if (!mData || mData.length === 0) {
      noDice.classList.remove("hidden");
    }

    renderMatches(mData, scoutedData);
    loadLeaderboard();
  })();
});

scrollBtn.addEventListener("click", () => {
  document.querySelector(".match-theme-active")?.scrollIntoView({ block: "center", behavior: "smooth" });
});

const teamSearchInput = document.getElementById("team-search");

function search() {
  const query = teamSearchInput.value.trim();
  const matchEls = document.querySelectorAll(".match:not(#ml-template)");
  matchEls.forEach((matchEl) => {
    if (!query) {
      matchEl.style.display = "";
      return;
    }
    const teams = matchEl.querySelectorAll("#m-blue th, #m-red th");
    const found = Array.from(teams).some((th) => (th.dataset.team ?? th.textContent) == query);
    matchEl.style.display = found ? "" : "none";
  });
}

teamSearchInput.addEventListener("input", search);
teamSearchInput.addEventListener("focus", () => {
  setTimeout(() => {
    search();
  }, 50);
});

// checked so the rest of the file still runs if the button ever gets removed from the html
if (offlineScoutBtn) {
  offlineScoutBtn.onclick = function () {
    location.href = `../HTML/scout.html?status=offline&eventKey=${eventKey}`;
  };
}

/* [
  {
    start: 1,
    end: 5,
    slot: "blue1",
  },
  {
    start: 6,
    end: 10,
    slot: "red3",
  },
]; */

window.nextPage = nextPage;
