// ONCE PUBLISHED TO WEBSITE ALL CLOUDFLARE WORKERS MUST BE MOVED TO AN OFFICIAL ACCOUNT

import { questionDB } from "/JS/DB.js";
import { getDB, getEvents, getEvent } from "/JS/DB.js";

export async function TBA_GET(endpoint) {
  // fetch the blue alliance with cloudflare auth worker
  // note if TBA adds any sort of rate limiting this will probably need to be changed
  try {
    const response = await fetch(`https://tba-auth.bheitz780.workers.dev${endpoint}`);
    const data = await response.json();
    return data;
  } catch (err) {
    // network error? i think
    return false;
  }
}

// OCCRA/offseason events are made in manage-events and live on our worker instead of TBA
export function isCustomEventKey(eventKey) {
  return /^\d{4}wlros-/.test(eventKey || "");
}

async function getCustomEvents() {
  try {
    const events = await getEvents();
    return Array.isArray(events) ? events : [];
  } catch (err) {
    console.error("Error fetching custom events:", err);
    return [];
  }
}

// OCCRA scoring changes every season SO THIS IS HARDCODED FOR NOW!!!! UPDATE THIS EACH YEAR (and if question ids change).
// question ids have points PER ROBOT. counters are points per ball, toggles are points if true. anything not listed is worth 0
const OCCRA_POINT_VALUES = {
  moved: 1,
  auton_high: 3,
  auton_low: 2,
  teleop_high: 2,
  teleop_low: 1,
};
// added ONCE to the winning alliance's score (not per robot), so it isn't part of any one team's own points
const OCCRA_WIN_POINTS = 10;
const OCCRA_WON_QUESTION = "won"; // "Alliance Won?" toggle
const OCCRA_NOSHOW_QUESTION = "noshow";

// get() gets a team's tallies
//   played = matches with a result, scouted = matches this team was scouted in
// careful: the leaderboard's AFC/AAFC columns read columns [1] and [2] as avg match scores
const OCCRA_RANKING_COLUMNS = [
  { id: "alliancePoints", name: "Alliance Points", precision: 0, get: (t) => t.alliancePoints },
  { id: "wins", name: "Wins", precision: 0, get: (t) => t.wins },
  { id: "winpercentage", name: "Win Percentage", precision: 1, get: (t) => (t.played ? (t.wins / t.played) * 100 : 0) },
  { id: "avgPoints", name: "Avg Points", precision: 1, get: (t) => (t.scouted ? t.totalPoints / t.scouted : 0) },
  { id: "totalPoints", name: "Total Points", precision: 0, get: (t) => t.totalPoints },
];
// how teams are ranked. first one decides, the rest break ties (team number is the final tiebreak).
// column = an id from OCCRA_RANKING_COLUMNS, higherIsBetter = false for stats where lower ranks higher
const OCCRA_RANK_ORDER = [
  { column: "alliancePoints", higherIsBetter: true },
  { column: "totalPoints", higherIsBetter: true },
  { column: "avgPoints", higherIsBetter: true },
];

const isYes = (v) => v === true || v === "true";
const isNo = (v) => v === false || v === "false";

// estimated points one robot scored in one match, from one scouting submission
function occraTeamPoints(answers) {
  if (isYes(answers[OCCRA_NOSHOW_QUESTION])) return 0;
  let points = 0;
  for (const [questionID, value] of Object.entries(OCCRA_POINT_VALUES)) {
    const answer = answers[questionID];
    if (isYes(answer)) points += value;
    else if (!isNo(answer) && answer !== "_IGNORE" && !isNaN(Number(answer))) points += Number(answer) * value;
  }
  return points;
}

// scouting rows -> Map(matchNumber -> Map(teamNumber -> [answers, ...])), answers flattened across categories
function collectScoutedMatches(scoutedRows) {
  const matches = new Map();
  for (const row of Array.isArray(scoutedRows) ? scoutedRows : []) {
    try {
      const data = JSON.parse(row.data)?.questions?.data ?? {};
      const answers = Object.assign({}, ...Object.values(data));
      const matchNum = Number(String(answers.match ?? "").trim());
      const team = String(Number(String(answers.team ?? "").trim()));
      if (!matchNum || team === "NaN" || team === "0") continue;
      if (!matches.has(matchNum)) matches.set(matchNum, new Map());
      const teams = matches.get(matchNum);
      if (!teams.has(team)) teams.set(team, []);
      teams.get(team).push(answers);
    } catch {}
  }
  return matches;
}

// { blue, red, winner, teamPoints, estimated } for a match, or null if it hasn't been played (no scores and nobody scouted it).
// real scores win if they exist. otherwise the scouts' "Alliance Won?" answers vote, and estimated points break ties.
// estimated scores = the alliance's robot points + OCCRA_WIN_POINTS for the winner.
// teamPoints is { "frc308": 12, ... } for each scouted team, robot points only (no win bonus)
function getMatchResult(match, scoutedMatches) {
  const { blue, red } = match.alliances;
  const hasScores = blue.score >= 0 && red.score >= 0;
  const submissions = scoutedMatches.get(Number(match.match_number));
  if (!hasScores && !submissions) return null;

  const score = { blue: 0, red: 0 };
  const teamPoints = {}; // filled even when real scores exist, so the leaderboard can use each team's own points
  let votes = 0; // positive = blue won
  for (const [side, alliance] of [
    ["blue", blue],
    ["red", red],
  ]) {
    for (const teamKey of alliance.team_keys) {
      const teamSubs = submissions?.get(teamKey?.slice(3));
      if (!teamSubs) continue;
      // more than one scout on the same robot gets averaged
      teamPoints[teamKey] = teamSubs.reduce((sum, answers) => sum + occraTeamPoints(answers), 0) / teamSubs.length;
      score[side] += teamPoints[teamKey];
      for (const answers of teamSubs) {
        const vote = isYes(answers[OCCRA_WON_QUESTION]) ? 1 : isNo(answers[OCCRA_WON_QUESTION]) ? -1 : 0;
        votes += side === "blue" ? vote : -vote;
      }
    }
  }

  if (hasScores) return { blue: blue.score, red: red.score, winner: match.winning_alliance || null, teamPoints, estimated: false };

  let winner = votes > 0 ? "blue" : votes < 0 ? "red" : null;
  if (!winner && score.blue !== score.red) winner = score.blue > score.red ? "blue" : "red";
  if (winner) score[winner] += OCCRA_WIN_POINTS;
  return { ...score, winner, teamPoints, estimated: true };
}

// match key -> getMatchResult, for matches whose result is estimated from scouting (OCCRA). used by the match list
export function getEstimatedMatchResults(mData, scoutedRows) {
  const scoutedMatches = collectScoutedMatches(scoutedRows);
  const results = new Map();
  for (const match of Array.isArray(mData) ? mData : []) {
    if (!match.alliances?.blue || !match.alliances?.red) continue;
    const result = getMatchResult(match, scoutedMatches);
    if (result?.estimated) results.set(match.key, result);
  }
  return results;
}

// TBA-shaped rankings built from played matches, since TBA has nothing for custom events.
// every scheduled team gets an entry (even with 0 played) so the leaderboard lists them before results exist.
// columns and rank order come from OCCRA_RANKING_COLUMNS / OCCRA_RANK_ORDER
export function computeRankings(mData, scoutedRows = []) {
  const scoutedMatches = collectScoutedMatches(scoutedRows);
  const teams = {};
  for (const match of Array.isArray(mData) ? mData : []) {
    const blue = match.alliances?.blue;
    const red = match.alliances?.red;
    if (!blue || !red) continue;
    const result = getMatchResult(match, scoutedMatches);

    for (const [side, alliance] of [
      ["blue", blue],
      ["red", red],
    ]) {
      // every scouted robot on this alliance (own + partners'), plus the win bonus once if the alliance won
      const allianceTotal = result ? alliance.team_keys.reduce((sum, key) => sum + (result.teamPoints[key] ?? 0), 0) + (result.winner === side ? OCCRA_WIN_POINTS : 0) : 0;
      for (const teamKey of alliance.team_keys) {
        if (!teamKey) continue;
        const t = (teams[teamKey] ??= { wins: 0, losses: 0, ties: 0, played: 0, totalPoints: 0, alliancePoints: 0, scouted: 0 });
        if (!result) continue;
        t.played++;
        t.alliancePoints += allianceTotal;
        // a match where this team wasn't scouted still counts for wins, just not for the points average
        if (result.teamPoints[teamKey] !== undefined) {
          t.scouted++;
          t.totalPoints += result.teamPoints[teamKey];
        }
        if (!result.winner) t.ties++;
        else if (result.winner === side) t.wins++;
        else t.losses++;
      }
    }
  }

  const rankBy = OCCRA_RANK_ORDER.map(({ column, higherIsBetter }) => ({
    index: OCCRA_RANKING_COLUMNS.findIndex((col) => col.id === column),
    dir: higherIsBetter ? -1 : 1,
  })).filter(({ index }) => index !== -1);

  const anyScored = Object.values(teams).some((t) => t.played > 0);
  const rankings = Object.entries(teams)
    .map(([team_key, t]) => ({
      team_key,
      matches_played: t.played,
      record: { wins: t.wins, losses: t.losses, ties: t.ties },
      sort_orders: OCCRA_RANKING_COLUMNS.map((col) => col.get(t)),
    }))
    .sort((a, b) => {
      for (const { index, dir } of rankBy) {
        const diff = (a.sort_orders[index] - b.sort_orders[index]) * dir;
        if (diff) return diff;
      }
      return a.team_key.slice(3) - b.team_key.slice(3);
    })
    .map((entry, i) => ({ rank: anyScored ? i + 1 : null, ...entry })); // no scores yet -> ranks would just be team order

  return {
    rankings,
    sort_order_info: OCCRA_RANKING_COLUMNS.map(({ name, precision }) => ({ name, precision })),
    extra_stats_info: [],
  };
}

// OCCRA has no live results or accurate match timing, so a match counts as played once anyone has scouted it
function markScoutedMatches(mData, scoutedRows) {
  if (!Array.isArray(mData) || !Array.isArray(scoutedRows)) return;
  const scouted = new Set();
  for (const row of scoutedRows) {
    try {
      const data = JSON.parse(row.data)?.questions?.data ?? {};
      for (const category in data) {
        const matchNum = Number(data[category]?.match);
        if (matchNum) scouted.add(matchNum);
      }
    } catch {}
  }
  mData.forEach((match) => {
    if (scouted.has(Number(match.match_number))) match._scouted = true;
  });
}

export function isAdmin() {
  return localStorage.getItem("isAdmin") === "true";
}

export function getUserTeam() {
  const token = localStorage.getItem("scoutingAuthToken");
  //if (!token) return false;

  const dToken = atob(token);
  let team = "308";

  if (dToken.includes("7178")) {
    team = "7178";
  }

  return team;
}

export async function isActiveEvent(overrideStr) {
  // returns { isActive: boolean, event: currentevent/nextevent/null}

  if (overrideStr) {
    const event = isCustomEventKey(overrideStr) ? await getEvent(overrideStr).catch(() => null) : await TBA_GET(`/event/${overrideStr}`);
    if (!event || !event.key) return false;
    newEventCache(event.key);
    return { isActive: true, event };
  }

  let currentEvent = null;
  let nextEvent = null;
  const devOverride = true;

  try {
    const team = getUserTeam();
    const now = new Date();

    const [tbaEvents, customEvents] = await Promise.all([TBA_GET(`/team/frc${team}/events/${now.getUTCFullYear()}`), getCustomEvents()]);

    if (!tbaEvents && !customEvents.length) return false;
    const events = [...(Array.isArray(tbaEvents) ? tbaEvents : []), ...customEvents];

    for (const details of events) {
      const start = new Date(details.start_date + "T00:00:00");
      const end = new Date(details.end_date + "T23:59:59");

      // active event in range
      if (now >= start && now <= end) {
        currentEvent = details;
        break;
      }

      // soonest upcoming event
      if (start > now) {
        if (nextEvent === null || start < new Date(nextEvent.start_date)) {
          nextEvent = details;
        }
      }
    }
  } catch (error) {
    alert("Error fetching events:", error);
    console.error("Error fetching events:", error);
    return false;
  }

  if (currentEvent) {
    newEventCache(currentEvent.key);
    return {
      isActive: true,
      event: currentEvent,
    };
  }

  if (nextEvent) {
    return {
      isActive: devOverride,
      event: nextEvent,
    };
  }

  // end of the season???
  return {
    isActive: false,
    event: null,
  };
}

export function retagResponses(untaggedResponses, questions, offlineEnabled = true, disabledIds = new Set()) {
  if (!questions) {
    return null;
  }

  const retaggedResponses = {};

  for (const categoryId in untaggedResponses) {
    if (!questions[categoryId]) continue;

    retaggedResponses[categoryId] = {};

    const categoryQuestions = questions[categoryId];

    untaggedResponses[categoryId].forEach((value, index) => {
      const q = categoryQuestions[index];
      if (q && q.id) {
        if (!offlineEnabled && q.offline === true) return;
        retaggedResponses[categoryId][q.id] = disabledIds.has(q.id) ? "_IGNORE" : value;
      }
    });
  }

  return retaggedResponses;
}

export async function populateQuestions(questions, categoryID, categoryFormElement, responses = {}, dependentElements = [], onResponseChange = () => {}) {
  const id = categoryID;
  const categoryData = questions[categoryID];
  let questionLookup = {};
  function newTemplateFromID(id) {
    const templates = Array.from(document.querySelectorAll(".form-template"));
    const foundEl = templates.find((template) => template.id === id) || null;
    if (foundEl) {
      const newEl = foundEl.cloneNode(true);
      return newEl;
    }
    return;
  }
  categoryData?.forEach((questionInfo, index) => {
    const qType = questionInfo.type;
    const element = newTemplateFromID(qType);

    element.dataset.questionIndex = index; // array position
    element.dataset.questionId = questionInfo.id;

    const qHeader = element.querySelector("#question-header");
    qHeader.textContent = questionInfo.header;
    (responses[id] ??= [])[index] = questionInfo.state;

    if (questionInfo.offline == true) {
      element.classList.add("offlineQuestion");
    }

    const infoBtn = element.querySelector(".infobtn");
    if (questionInfo.info) {
      infoBtn.addEventListener("click", (e) => {
        showPopup(true, questionInfo.info.header, questionInfo.info.body);
      });
    } else {
      infoBtn.style.display = "none";
    }

    if (qType == "toggle") {
      //toggle
      const qText = element.querySelector("#question-text");
      if (!questionInfo.text || questionInfo.text === "") {
        qText.remove();
      } else {
        qText.textContent = questionInfo.text;
      }
      const checkbox = element.querySelector("input[type=checkbox]");
      checkbox.id = `${id}-${index}-toggle`;
      if (questionInfo.state) {
        checkbox.checked = true;
      }

      checkbox.addEventListener("change", (e) => {
        onResponseChange(e.target.id, e.target.checked);
      });
    } else if (qType == "dropdown") {
      //dropdown
      const placeholder = element.querySelector("#option-placeholder");
      const select = element.querySelector("select");
      select.id = `${id}-${index}-select`;

      for (const optionIndex in questionInfo["dropdown-options"]) {
        const option = placeholder.cloneNode(true);
        option.textContent = questionInfo["dropdown-options"][optionIndex];
        placeholder.parentNode.appendChild(option);
      }
      placeholder.textContent = questionInfo.state;

      select.addEventListener("change", (e) => {
        onResponseChange(e.target.id, e.target.value);
      });
      select.value = questionInfo.state;
    } else if (qType == "text" || qType == "textarea") {
      //text inputs
      const input = element.querySelector("#text");
      input.id = `${id}-${index}-text`;
      input.placeholder = questionInfo.placeholder;
      input.value = questionInfo.state;

      input.addEventListener("input", (e) => {
        onResponseChange(e.target.id, e.target.value);
      });
    } else if (qType == "counter") {
      //counter
      const count = element.querySelector("#count");
      count.id = `${id}-${index}-count`;
      count.value = questionInfo.state;
      count.textContent = questionInfo.state;

      const decrementBtn = element.querySelector('button[onclick*="decrementCounter"]');
      const incrementBtn = element.querySelector('button[onclick*="incrementCounter"]');

      if (decrementBtn) {
        decrementBtn.setAttribute("onclick", `decrementCounter('${count.id}')`);
      }
      if (incrementBtn) {
        incrementBtn.setAttribute("onclick", `incrementCounter('${count.id}')`);
      }
    } else if (qType == "slider") {
      //slider
      const slider = element.querySelector("#range");
      const value = element.querySelector("#slider-value");
      const min = element.querySelector("#min-label");
      const max = element.querySelector("#max-label");

      slider.id = `${id}-${index}-slider`;
      value.id = `${id}-${index}-slider-value`;

      slider.min = questionInfo.min;
      slider.max = questionInfo.max;
      slider.step = questionInfo.step;
      slider.value = questionInfo.state;
      value.textContent = questionInfo.state;
      min.textContent = questionInfo["label-min"];
      max.textContent = questionInfo["label-max"];

      slider.addEventListener("input", (e) => {
        value.textContent = e.target.value;
        onResponseChange(e.target.id, Number(e.target.value));
      });
    } else if (qType == "timer") {
      //timer
      const timeInput = element.querySelector("#time");
      timeInput.id = `${id}-${index}-time`;
      timeInput.value = questionInfo.state;

      const playPauseBtn = element.querySelector("#play-pause-btn");
      const restartBtn = element.querySelector("#restart-btn");
      const playPauseIcon = playPauseBtn.querySelector("ion-icon");

      playPauseBtn.id = `${id}-${index}-play-pause`;
      restartBtn.id = `${id}-${index}-restart`;

      let isRunning = false;
      let startTime = 0;
      let elapsedTime = 0;
      let intervalId = null;

      playPauseBtn.addEventListener("click", () => {
        if (isRunning) {
          // pause
          clearInterval(intervalId);
          isRunning = false;
          onResponseChange(timeInput.id, (elapsedTime / 1000).toFixed(2));
          playPauseIcon.setAttribute("name", "play");
        } else {
          // play
          startTime = Date.now() - elapsedTime;
          intervalId = setInterval(() => {
            elapsedTime = Date.now() - startTime;
            const seconds = (elapsedTime / 1000).toFixed(2);
            timeInput.value = seconds;
            onResponseChange(timeInput.id, seconds, true);
          }, 10); //ms
          isRunning = true;
          playPauseIcon.setAttribute("name", "pause");
        }
      });

      restartBtn.addEventListener("click", () => {
        clearInterval(intervalId);
        isRunning = false;
        elapsedTime = 0;
        timeInput.value = "0.00";
        playPauseIcon.setAttribute("name", "play");
        onResponseChange(timeInput.id, "0.00");
      });

      timeInput.addEventListener("input", (e) => {
        // this'll prob lag like hell so might have to change later
        if (isRunning) {
          clearInterval(intervalId);
          isRunning = false;
          playPauseIcon.setAttribute("name", "play");
        }
        // oh lord idk here
        const manualValue = parseFloat(e.target.value) || 0;
        elapsedTime = manualValue * 1000;
        onResponseChange(e.target.id, e.target.value, true);
      });
    } else {
      console.warn("missing case or element for type:", qType);
    }

    if (questionInfo.id) {
      questionLookup[questionInfo.id] = {
        defaultState: questions[id][index].state,
        hideDependencies: questions[id][index]["hide-dependencies"] ?? null,
        categoryId: id,
        questionIndex: index,
      };
    }
    if (questionInfo.depends || questionInfo.offline) {
      dependentElements.push({
        element,
        depends: questionInfo.depends || [],
        isOffline: questionInfo.offline === true,
      });
    }

    categoryFormElement.appendChild(element);
    element.classList.remove("form-template");
  });
  return { responses, questionLookup };
}

export async function newEventCache(eventKey, questionsFetcher) {
  const isCustom = isCustomEventKey(eventKey);
  const eventFetcher = isCustom ? getEvent(eventKey).then(({ matches, ...details }) => [matches || [], details]) : Promise.all([TBA_GET(`/event/${eventKey}/matches`), TBA_GET(`/event/${eventKey}`)]);
  let [[mData, eventDetails], questionsData, scoutedData] = await Promise.all([eventFetcher, questionsFetcher ? questionsFetcher() : questionDB("GET"), getDB(`/db?eventKey=${eventKey}`)]);

  if (mData && mData.length !== 0) {
    mData.sort((a, b) => {
      const matchTypeOrder = { qm: 1, ef: 2, qf: 3, sf: 4, f: 5 };
      if (matchTypeOrder[a.comp_level] !== matchTypeOrder[b.comp_level]) {
        return matchTypeOrder[a.comp_level] - matchTypeOrder[b.comp_level];
      }
      const aNum = a.comp_level === "sf" ? a.set_number : a.match_number;
      const bNum = b.comp_level === "sf" ? b.set_number : b.match_number;
      if (aNum === bNum) return a.match_number - b.match_number;
      return aNum - bNum;
    });
  }

  if (isCustom) markScoutedMatches(mData, scoutedData?.data);

  const lastUpdated = new Date().getTime();
  //sorted, per-team averages. HELL! HELL! HELL!
  const scoutedDataPTAvgs = scoutedData?.data ? getAllTeamAverages(scoutedData.data, questionsData) : {};
  const scoutedDataPTAvgsFlat = {};
  for (const team in scoutedDataPTAvgs) {
    scoutedDataPTAvgsFlat[team] = {};
    for (const category in scoutedDataPTAvgs[team]) {
      for (const questionID in scoutedDataPTAvgs[team][category]) {
        scoutedDataPTAvgsFlat[team][questionID] = scoutedDataPTAvgs[team][category][questionID];
      }
    }
  }
  const cache = { mData, eventDetails, lastUpdated, questionsData, scoutedData: scoutedData.data, scoutedDataPTAvgs, scoutedDataPTAvgsFlat };
  if (isCustom) cache.rankings = computeRankings(mData, scoutedData?.data);
  localStorage.setItem(`eventCache_${eventKey}`, JSON.stringify(cache));
  localStorage.setItem("currentEventKey", eventKey);
  return cache;
}

export function getAllTeamAverages(scoutedData, questionsData) {
  // raw submissions, by team
  const organizedTeams = {};
  for (const i in scoutedData) {
    const guh = JSON.parse(scoutedData[i].data);
    const submission = JSON.parse(scoutedData[i].data)?.questions;
    const data = submission?.data;
    const sorted = { _scoutID: guh.scoutID };
    for (const category in data) {
      for (const questionID in data[category]) {
        sorted[questionID] = { value: data[category][questionID], category, version: submission.version || -1 };
      }
    }
    const team = sorted.team?.value;
    if (team) {
      if (!organizedTeams[team]) organizedTeams[team] = [];
      organizedTeams[team].push(sorted);
    }
  }

  const questionsRaw = questionsData?.data ?? {};
  const questionTypes = {};
  for (const categoryID in questionsRaw) {
    for (const question of questionsRaw[categoryID]) {
      if (question.id) questionTypes[question.id] = question.type;
    }
  }

  // note for future developers: "sorry"

  const allTeamAverages = {};
  for (const teamKey in organizedTeams) {
    const submissions = organizedTeams[teamKey];
    const getVersion = (s) => Object.entries(s).find(([k]) => k !== "_scoutID")?.[1]?.version ?? -1;
    const maxVersion = Math.max(...submissions.map(getVersion));
    const layoutRef = submissions.find((s) => getVersion(s) === maxVersion);
    const validQuestions = new Set(Object.keys(layoutRef ?? {}));

    const collected = {};
    for (const submission of submissions) {
      for (const questionID in submission) {
        if (questionID === "_scoutID") continue;
        if (!validQuestions.has(questionID)) continue;
        const { value, category } = submission[questionID];
        if (!collected[category]) collected[category] = {};
        if (!collected[category][questionID]) collected[category][questionID] = [];
        if (value === "_IGNORE") continue;
        const coerced = typeof value === "boolean" ? value : isNaN(Number(value)) || value === "" ? value : Math.round(Number(value) * 100) / 100;
        if (questionTypes[questionID] === "timer" && Math.floor(parseInt(Number(coerced))) == 0) continue;
        collected[category][questionID].push(coerced);
      }
    }
    const result = {};
    for (const category in collected) {
      result[category] = {};
      for (const questionID in collected[category]) {
        const values = collected[category][questionID];
        if (values.length === 0) {
          result[category][questionID] = { value: "_IGNORE" };
          continue;
        }
        const numericCount = values.filter((v) => typeof v === "number").length;
        const isNumberLike = numericCount > values.length / 2;
        const boolLikeCount = values.filter((v) => v === true || v === false || v == "true" || v == "false").length;
        const isBoolLike = boolLikeCount > values.length / 2;

        if (isNumberLike) {
          const numericValues = values.filter((v) => typeof v === "number");
          const avg = Math.round((numericValues.reduce((acc, v) => acc + v, 0) / numericValues.length) * 100) / 100;
          result[category][questionID] = { value: avg };
        } else {
          const freq = {};
          for (const v of values) {
            freq[v] = (freq[v] || 0) + 1;
          }
          const maxFreq = Math.max(...Object.values(freq));
          const topValues = Object.keys(freq).filter((k) => freq[k] === maxFreq);
          // yesRate: fraction of true responses
          const yesRate = isBoolLike ? Math.round((values.filter((v) => v === true).length / boolLikeCount) * 100) / 100 : undefined;
          if (topValues.length === 1) {
            result[category][questionID] = { value: topValues[0], frequency: Math.round((maxFreq / values.length) * 100) / 100, totalCount: values.length, yesRate };
          } else {
            result[category][questionID] = { value: isBoolLike ? topValues[0] : "Mixed", frequency: Math.round((maxFreq / values.length) * 100) / 100, totalCount: values.length, yesRate };
          }
        }
      }
    }
    allTeamAverages[teamKey] = result;
  }
  return allTeamAverages;
}

export async function getAllScoutedLbColums() {}

// #choice-popup used in /admin files
// [{ label, onClick }]
export function showChoicePopup(headerText, choices) {
  const popup = document.getElementById("choice-popup");
  const header = document.getElementById("choice-header");
  const list = popup.querySelector(".c-list");
  const template = document.getElementById("choice-btn-template");
  const closeBtn = document.getElementById("close-frame-btn");

  header.textContent = headerText;
  list.querySelectorAll(".choice-btn").forEach((el) => el.remove());

  choices.forEach(({ label, icon, onClick }) => {
    const btn = template.cloneNode(true);
    const thing = btn.querySelector(".btn-icon");
    btn.removeAttribute("id");
    btn.classList.remove("hidden");
    if (icon == "none") {
      thing.remove();
    }
    thing.name = icon || "add-circle";
    btn.classList.add("choice-btn");
    btn.lastChild.textContent = label;
    btn.addEventListener("click", () => {
      hideChoicePopup();
      onClick?.();
    });
    list.appendChild(btn);
  });

  if (!closeBtn.dataset.wired) {
    closeBtn.addEventListener("click", hideChoicePopup);
    closeBtn.dataset.wired = "true";
  }

  popup.classList.remove("choice-hidden");
}

export function hideChoicePopup() {
  document.getElementById("choice-popup")?.classList.add("choice-hidden");
}

window.reloadPage = function () {
  const eventKey = localStorage.getItem("currentEventKey");
  const CACHE_KEY = `eventCache_${eventKey}`;
  localStorage.removeItem(CACHE_KEY);
  location.reload();
};

window.logout = (param) => {
  if (param === "redirect=scout") {
    // switch profile
    localStorage.removeItem("userProfile");
    const eventKey = localStorage.getItem("currentEventKey");
    const eventParam = eventKey ? `&eventKey=${eventKey}` : "";
    window.location = `/HTML/profiles.html?redirect=scout${eventParam}`;
    return;
  }
  localStorage.removeItem("scoutingAuthToken");
  localStorage.removeItem("userProfile");
  window.location = `/HTML/login.html`;
};
