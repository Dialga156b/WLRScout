import { TBA_GET, isCustomEventKey, computeRankings } from "../utils.js";
import { getDB } from "../DB.js";

const urlParams = new URLSearchParams(window.location.search);
const eventKey = urlParams.get("eventKey");

const useOnlineLeaderboardLayout = true;
const STALE_DATA_MINUTES = 30; // warn to refetch if cached data is older than this
const TEAM_AVATAR_YEAR = 2026; // TBA avatars are per season

export const LEADERBOARD_COLUMNS_OFFLINE = [
  { id: "total-rp", label: "Total RP" },
  { id: "winrate", label: "Winrate" },
  { id: "avg-score", label: "Avg Score" },
  { id: "ap-potential", label: "AP Potential" },
];

// derived from other stats in createTeam, not questions. only shown when the question they need exists
const LEADERBOARD_COLUMNS_DERIVED = [
  { id: "AFC", label: "Avg Fuel Contribution", needs: "contribution" },
  { id: "AAFC", label: "ESTIMATED Auton Fuel", needs: "contribution" },
];
export let LEADERBOARD_COLUMNS = [];

async function initLeaderboard() {
  //check for stale data in the api, ask to fallback to scouted data only if last valid match is over 30m ago or there is no matches completed at all
  //TODO finish this
  const eventData = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`));
  const now = new Date().getTime();
  const lastUpdated = eventData?.lastUpdated || now;

  const endDate = new Date(eventData?.eventDetails?.end_date || 0).getTime();

  if (endDate && endDate < now) {
    return;
  }

  const seconds = Math.floor(Math.abs(lastUpdated - now) / 1000);
  if (seconds > 60 * STALE_DATA_MINUTES) {
    confirm(`A failsafe detected this data may be stale (${STALE_DATA_MINUTES}+ minutes old). It is recommended to refetch data.`);
  }
  console.log(`Last fetched data ${seconds}s ago`);
}

initLeaderboard();

function getQuestionsFlat() {
  const evRaw = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`)) ?? {};
  const questions = evRaw.questionsData.data;
  var sorted = {};
  for (const category in questions) {
    for (const questionID in questions[category]) {
      sorted[questions[category][questionID].id] = questions[category][questionID];
    }
  }
  return sorted;
}

// every question with a leaderboard "lb-header" gets a Local column (in question order), labeled with that header.
// ids are the question id that it'll try to get the info from
function getScoutedColumns() {
  let qFlat = {};
  try {
    qFlat = getQuestionsFlat();
  } catch {} // no questions cached yet
  const columns = Object.values(qFlat)
    .filter((question) => question?.leaderboard?.["lb-header"])
    .map((question) => ({ id: question.id, label: question.leaderboard["lb-header"] }));
  const derived = LEADERBOARD_COLUMNS_DERIVED.filter((col) => qFlat[col.needs]).map(({ id, label }) => ({ id, label }));
  return [...columns, ...derived];
}

async function reorganizeLeaderboardData() {
  if (useOnlineLeaderboardLayout) {
    var evRaw = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`)) ?? {};
    // custom (OCCRA) events have no TBA rankings, build them from the schedule + scouting instead.
    // always recomputed (it's cheap) so it's never stuck on rankings from an older cache
    const raw = isCustomEventKey(eventKey) ? computeRankings(evRaw.mData, evRaw.scoutedData) : (evRaw.rankings ?? (await TBA_GET(`/event/${eventKey}/rankings`)));
    if (!raw || !raw.rankings) return { tbaColumns: [], scoutedColumns: getScoutedColumns(), rows: [] };
    evRaw.rankings = raw;
    localStorage.setItem(`eventCache_${eventKey}`, JSON.stringify(evRaw));

    const sortCols = (raw.sort_order_info ?? []).map((info, i) => ({
      id: `sort-${i}`,
      label: info.name,
      precision: info.precision ?? 0,
      source: "sort_orders",
      index: i,
    }));

    const extraCols = (raw.extra_stats_info ?? []).map((info, i) => ({
      id: `extra-${i}`,
      label: info.name,
      precision: info.precision ?? 0,
      source: "extra_stats",
      index: i,
    }));

    const tbaColumns = [...sortCols, ...extraCols];
    const scoutedColumns = getScoutedColumns();

    const rows = raw.rankings.map((entry) => {
      const stats = { rank: entry.rank };
      sortCols.forEach((col) => {
        const val = entry.sort_orders?.[col.index];
        stats[col.id] = val != null ? +val.toFixed(col.precision) : "-";
      });
      extraCols.forEach((col) => {
        const val = entry.extra_stats?.[col.index];
        stats[col.id] = val != null ? +val.toFixed(col.precision) : "-";
      });
      const qFlat = getQuestionsFlat();
      scoutedColumns.forEach((col) => {
        //scoutedDataPTAvgs(Flat) is a thing so i can ez yoink it straight from there
        const teamID = entry.team_key.slice(3);
        const question = qFlat[col.id] || {};

        try {
          const res = evRaw.scoutedDataPTAvgsFlat[teamID][col.id];
          var out = res.value;

          if (out === "_IGNORE") {
            out = "[N/A]";
          } else {
            if (question.type == "toggle" && res.yesRate !== undefined) {
              // boolean question
              const inverted = question?.leaderboard?.["lb-bool-inverted"] || false;
              if (inverted) {
                out = Math.round((1 - res.yesRate) * 100);
              } else {
                out = Math.round(res.yesRate * 100);
              }
            } else if (typeof out === "string") {
              out = `${res.value} (${Math.round(res.frequency * 100)}%)`;
            }
          }
        } catch {
          //console.error(evRaw.scoutedDataPTAvgsFlat[teamID], col.id);
        }

        stats[col.id] = out;
      });
      return { teamKey: entry.team_key, stats };
    });

    return { tbaColumns, scoutedColumns, rows };
  } else {
    const raw = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`)).eventDetails;

    const scoutedData = raw?.data;
    const questionLayout = raw?.questions; // to get the names of the categories n stuff
    return { tbaColumns: LEADERBOARD_COLUMNS_OFFLINE, scoutedColumns: getScoutedColumns(), rows: [] };
  }
}

//relative coloring of stat cells, only applies to numeric stats
function colorStatCellsRelative(columns) {
  // find min/max
  const colStats = columns.map((_, colIndex) => {
    let min = Infinity,
      max = -Infinity;
    document.querySelectorAll(".team:not(.template) .team-stat").forEach((stat, i) => {
      if (i % columns.length !== colIndex) return;
      const val = parseFloat(stat.textContent);
      if (isNaN(val)) return;
      if (val < min) min = val;
      if (val > max) max = val;
    });
    return { min, max };
  });

  document.querySelectorAll(".team:not(.template)").forEach((teamEl) => {
    Array.from(teamEl.querySelectorAll(".team-stat")).forEach((stat, colIndex) => {
      const val = parseFloat(stat.textContent);
      const { min, max } = colStats[colIndex];

      stat.classList.remove("match-low");
      stat.classList.remove("match-high");

      if (isNaN(val) || min === max) return;

      const ratio = (val - min) / (max - min);
      const hue = ratio * 120;
      stat.style.backgroundColor = `hsla(${hue}, 80%, 45%, var(--stat-bg-opacity))`;

      if (val == max) {
        stat.classList.add("match-high");
      } else if (val == min) {
        stat.classList.add("match-low");
      }
    });
  });
}

var inspectedTeam = null;

export async function loadLeaderboard() {
  const teamList = document.getElementById("team-list");
  const template = document.getElementById("lb-team-template");

  function createTeam(teamNumber, stats, columns) {
    const el = template.cloneNode(true);
    el.querySelector(".team-id").textContent = teamNumber;
    el.querySelector(".team-logo").src = `https://www.thebluealliance.com/avatar/${TEAM_AVATAR_YEAR}/frc${teamNumber}.png`;
    el.querySelector(".team-rank").textContent = stats.rank ?? "N/A";

    const statElTemplate = el.querySelector(".team-stat");
    if (statElTemplate !== undefined) {
      columns.forEach((col, i) => {
        const thisElement = statElTemplate.cloneNode(true);
        const isValid = stats[col.id] || false;
        const TBASortOrders = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`))?.rankings?.rankings?.[stats.rank - 1];

        if (isValid) {
          thisElement.textContent = isValid;
        } else if (col.id === "AFC") {
          const contribution = Number(stats["contribution"]);
          const avgMatch = TBASortOrders?.sort_orders?.[1] ?? 0;
          thisElement.textContent = Math.round((avgMatch / 100) * contribution);
        } else if (col.id === "AAFC") {
          const contribution = Number(stats["contribution"]);
          const avgMatch = TBASortOrders?.sort_orders?.[2] ?? 0;
          thisElement.textContent = Math.round((avgMatch / 100) * contribution);
        } else {
          thisElement.textContent = "0";
        }
        const filterBtn = document.querySelectorAll("#lb-filter .filter-option")[i];
        if (filterBtn?.classList.contains("col-hidden")) {
          thisElement.classList.add("col-hidden");
        }
        statElTemplate.parentNode.appendChild(thisElement);
      });
    }
    statElTemplate.remove();

    if (stats.rank === 1) el.classList.add("first");
    if (stats.rank === 2) el.classList.add("second");
    if (stats.rank === 3) el.classList.add("third");

    el.id = `team-${teamNumber}`;
    el.classList.remove("hidden", "template");
    teamList.appendChild(el);

    colorStatCellsRelative(columns);

    const actionBtn = el.querySelector("#action-btn");

    actionBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!actionBtn.classList.contains("hidden")) {
        location.href = `/HTML/inspect.html?type=team&key=${teamNumber}`;
      }
    });

    el.addEventListener("click", () => {
      if (inspectedTeam && inspectedTeam !== teamNumber) {
        document.getElementById(`team-${inspectedTeam}`)?.querySelector("#action-btn").classList.add("hidden");
      }
      actionBtn.classList.toggle("hidden");
      actionBtn.innerHTML = `<ion-icon class="ionicon" name="open-outline"></ion-icon> View Team Data`;
      inspectedTeam = teamNumber;
    });

    return el;
  }

  const matchData = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`))?.mData;
  if (!matchData) {
    console.warn("No matchMatches in localStorage — leaderboard skipped.");
    template.classList.add("hidden");
    return;
  }

  const { tbaColumns, scoutedColumns, rows } = await reorganizeLeaderboardData();

  // OCCRA's "TBA" columns are our own computed wins/scores, so they get a different name
  const lbSets = [
    { label: isCustomEventKey(eventKey) ? "Results" : "TBA", columns: tbaColumns },
    { label: "Local", columns: scoutedColumns },
  ].filter(({ columns }) => columns.length > 0);
  if (lbSets.length === 0) lbSets.push({ label: "Local", columns: scoutedColumns });
  document.getElementById("nextLbBtn").classList.toggle("hidden", lbSets.length < 2);
  let currentLbIndex = 0;

  function renderLb() {
    // clear rows
    teamList.querySelectorAll(".team:not(.template)").forEach((el) => el.remove());

    const { label, columns } = lbSets[currentLbIndex];
    document.getElementById("lb-header").textContent = label;

    LEADERBOARD_COLUMNS.length = 0;
    columns.forEach((c) => LEADERBOARD_COLUMNS.push(c));
    document.dispatchEvent(new CustomEvent("lb-columns-ready"));

    rows
      .sort((a, b) => (a.stats.rank ?? 0) - (b.stats.rank ?? 0))
      .forEach(({ teamKey, stats }) => {
        const number = teamKey.replace("frc", "");
        createTeam(number, stats, columns);
      });

    console.warn("Leaderboard rendered:", label, columns);
  }

  document.getElementById("nextLbBtn").addEventListener("click", () => {
    currentLbIndex = (currentLbIndex + 1) % lbSets.length;
    renderLb();
  });

  renderLb();

  template.classList.add("hidden");
}

document.addEventListener("lb-sort-change", ({ detail }) => {
  const teamList = document.getElementById("team-list");
  const teams = Array.from(teamList.querySelectorAll(".team:not(.template)"));
  if (detail.col === null) {
    teams
      .sort((a, b) => {
        const ra = parseInt(a.querySelector(".team-rank").textContent) || 9999;
        const rb = parseInt(b.querySelector(".team-rank").textContent) || 9999;
        return ra - rb;
      })
      .forEach((el) => {
        //const guh = el.querySelector(".team-sub-rank");
        //guh.style.display = "block";
        //guh.textContent = teams.indexOf(el);
        teamList.appendChild(el);
      });
    return;
  }

  const colId = detail.id;
  const dir = detail.dir === "asc" ? 1 : -1;

  teams
    .sort((a, b) => {
      // only works if each stat is in the right order but who cares amirite
      const statsA = Array.from(a.querySelectorAll(".team-stat"));
      const statsB = Array.from(b.querySelectorAll(".team-stat"));
      const valA = parseFloat(statsA[detail.col]?.textContent) ?? -Infinity;
      const valB = parseFloat(statsB[detail.col]?.textContent) ?? -Infinity;
      if (isNaN(valA) && isNaN(valB)) return 0;
      if (isNaN(valA)) return 1;
      if (isNaN(valB)) return -1;
      return (valA - valB) * dir;
    })
    .forEach((el) => teamList.appendChild(el));
});

//sort + column paging. entirely claude!!! spending my time on this wouldnt have been worth it especially due to the time constraints

(function () {
  const ICON_DEFAULT = "chevron-expand-outline";
  const ICON_ASC = "chevron-up-outline";
  const ICON_DESC = "chevron-down-outline";

  const isMobile = ("ontouchstart" in window || navigator.maxTouchPoints > 0) && window.innerWidth <= 600;
  if (isMobile) document.body.classList.add("is-mobile");

  const nextBtn = document.getElementById("lb-next-btn");
  const lbFilter = document.getElementById("lb-filter");

  // ── Column buttons are built once columns are known ────────────────────────
  function buildFilterButtons(columns) {
    lbFilter.innerHTML = "";
    columns.forEach((col, i) => {
      const btn = document.createElement("button");
      btn.className = "filter-option";
      btn.dataset.col = i;
      btn.dataset.colId = col.id;
      btn.textContent = col.label + " ";
      const icon = document.createElement("ion-icon");
      icon.setAttribute("name", ICON_DEFAULT);
      btn.appendChild(icon);
      lbFilter.appendChild(btn);
    });
    return Array.from(lbFilter.querySelectorAll(".filter-option"));
  }

  let filterBtns = [];
  let totalCols = 0;

  function initUI(columns) {
    filterBtns = buildFilterButtons(columns);
    totalCols = filterBtns.length;
    attachSortHandlers();
    layout();
  }

  // If columns arrive before DOMContentLoaded finishes, wait for the event
  document.addEventListener("lb-columns-ready", () => {
    initUI(LEADERBOARD_COLUMNS);
  });

  // Fallback: if offline mode with static columns, init immediately
  if (!useOnlineLeaderboardLayout && LEADERBOARD_COLUMNS.length) {
    document.addEventListener("DOMContentLoaded", () => initUI(LEADERBOARD_COLUMNS));
  }

  // ── Sort state ─────────────────────────────────────────────────────────────
  let sortState = { col: null, dir: null };

  function applySort(col, dir) {
    sortState = { col, dir };
    filterBtns.forEach((btn, i) => {
      const icon = btn.querySelector("ion-icon");
      if (i === col) {
        btn.classList.add("active");
        icon.setAttribute("name", dir === "asc" ? ICON_ASC : ICON_DESC);
      } else {
        btn.classList.remove("active");
        icon.setAttribute("name", ICON_DEFAULT);
      }
    });
    document.querySelectorAll(".team-stats-container").forEach((container) => {
      Array.from(container.querySelectorAll(".team-stat")).forEach((stat, i) => {
        stat.classList.toggle("active-sort", i === col);
      });
    });
    const id = sortState.col !== null ? LEADERBOARD_COLUMNS[sortState.col]?.id : null;
    document.dispatchEvent(new CustomEvent("lb-sort-change", { detail: { ...sortState, id } }));
  }

  function clearSort() {
    sortState = { col: null, dir: null };
    filterBtns.forEach((btn) => {
      btn.classList.remove("active");
      btn.querySelector("ion-icon").setAttribute("name", ICON_DEFAULT);
    });
    document.querySelectorAll(".team-stat").forEach((s) => s.classList.remove("active-sort"));
    document.dispatchEvent(new CustomEvent("lb-sort-change", { detail: { col: null, dir: null, id: null } }));
  }

  function attachSortHandlers() {
    filterBtns.forEach((btn, i) => {
      btn.addEventListener("click", () => {
        if (sortState.col !== i) applySort(i, "desc");
        else if (sortState.dir === "desc") applySort(i, "asc");
        else clearSort();
      });
    });
  }

  // ── Column paging ──────────────────────────────────────────────────────────
  let pageStart = 0;
  let colsPerPage = 0;

  function calcColsPerPage() {
    filterBtns.forEach((b) => {
      b.classList.remove("col-hidden");
      b.style.flex = "0 0 auto";
    });
    lbFilter.style.overflow = "visible";
    const naturalWidths = filterBtns.map((b) => b.getBoundingClientRect().width);
    lbFilter.style.overflow = "";
    filterBtns.forEach((b) => {
      b.style.flex = "";
    });

    const available = lbFilter.getBoundingClientRect().width;
    if (available <= 0) return Math.min(totalCols, totalCols);

    let count = 0,
      sum = 0;
    for (let i = 0; i < totalCols; i++) {
      sum += naturalWidths[i];
      if (sum > available + 0.5) break;
      count++;
    }
    return Math.max(1, count);
  }

  let dotsEl = null;
  function buildDots(numPages, currentPage) {
    if (!dotsEl) {
      dotsEl = document.createElement("div");
      dotsEl.className = "page-dots";
      nextBtn.appendChild(dotsEl);
    }
    dotsEl.innerHTML = "";
    if (numPages <= 1) return;
    for (let i = 0; i < numPages; i++) {
      const d = document.createElement("span");
      d.className = "page-dot" + (i === currentPage ? " active" : "");
      dotsEl.appendChild(d);
    }
  }

  function layout() {
    if (!totalCols) return;
    colsPerPage = calcColsPerPage();
    const needsPaging = colsPerPage < totalCols;
    const numPages = needsPaging ? Math.ceil(totalCols / colsPerPage) : 1;
    const currentPage = Math.min(Math.floor(pageStart / colsPerPage), numPages - 1);
    pageStart = currentPage * colsPerPage;
    const pageEnd = Math.min(pageStart + colsPerPage, totalCols);

    filterBtns.forEach((btn, i) => {
      btn.classList.toggle("col-hidden", needsPaging && (i < pageStart || i >= pageEnd));
    });
    document.querySelectorAll(".team-stats-container").forEach((container) => {
      Array.from(container.querySelectorAll(".team-stat")).forEach((stat, i) => {
        stat.classList.toggle("col-hidden", needsPaging && (i < pageStart || i >= pageEnd));
      });
    });

    const filterContainer = lbFilter.closest(".filter-container");
    filterContainer.classList.toggle("no-paging", !needsPaging);
    buildDots(numPages, currentPage);
  }

  nextBtn.addEventListener("click", () => {
    if (!totalCols) return;
    const numPages = Math.ceil(totalCols / colsPerPage);
    const currentPage = Math.floor(pageStart / colsPerPage);
    pageStart = ((currentPage + 1) % numPages) * colsPerPage;
    layout();
  });

  const ro = new ResizeObserver(() => layout());
  ro.observe(lbFilter);
})();
