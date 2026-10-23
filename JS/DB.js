import { isActiveEvent } from "./utils.js";
import { popupError } from "./event/scout.js";

export async function getUsers() {
  const res = await fetch("https://data.bheitz780.workers.dev/users");
  const users = await res.json();
  return users;
}

export async function updateUser(id, updates) {
  const res = await fetch("https://data.bheitz780.workers.dev/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...updates }),
  });
  if (!res.ok) throw new Error(`Failed to update user (${res.status})`);
  return res.json();
}

export async function addUser(data) {
  const res = await fetch("https://data.bheitz780.workers.dev/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to add user (${res.status})`);
  return res.json();
}

export async function deleteUser(id) {
  const res = await fetch(`https://data.bheitz780.workers.dev/users?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete user (${res.status})`);
}

export async function newEvent(data) {
  const res = await fetch("https://data.bheitz780.workers.dev/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to add new event (${res.status})`);
  return res.json();
}

// custom (OCCRA) events stored on the worker, shaped like TBA events + a `matches` array
export async function getEvents() {
  const res = await fetch("https://data.bheitz780.workers.dev/events", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to get events (${res.status})`);
  return res.json();
}

export async function getEvent(key) {
  const res = await fetch(`https://data.bheitz780.workers.dev/events?key=${encodeURIComponent(key)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to get event ${key} (${res.status})`);
  return res.json();
}

export async function updateEvent(key, updates) {
  const res = await fetch("https://data.bheitz780.workers.dev/events", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, ...updates }),
  });
  if (!res.ok) throw new Error(`Failed to update event ${key} (${res.status})`);
  return res.json();
}

export async function deleteEvent(key) {
  const res = await fetch(`https://data.bheitz780.workers.dev/events?key=${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete event ${key} (${res.status})`);
}

export async function questionDB(method, data, fetchOptions = {}) {
  if (method === "GET") {
    const res = await fetch("https://data.bheitz780.workers.dev/questions", fetchOptions);
    const questionData = await res.json();
    return questionData;
  } else if (method === "POST") {
    const res = await fetch("https://data.bheitz780.workers.dev/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Failed to save questions (${res.status})`);
    const result = await res.json();
    return result;
  }
}
export async function getDB(param) {
  const res = await fetch(`https://data.bheitz780.workers.dev${param}`, {
    method: "GET",
  });
  return res.json();
}

export async function submitQuestionsOnline(answers, scoutID, eventKey) {
  // miiiight want to make this check for auth tokens sometime. but not now. i don't care
  const resolvedKey = eventKey || localStorage.getItem("currentEventKey");
  const evCache = JSON.parse(localStorage.getItem(`eventCache_${resolvedKey}`));
  const thisEvent = evCache?.eventDetails || (await isActiveEvent()).event;

  if (!thisEvent && !navigator.onLine) {
    popupError("You seem to be offline. try uploading with QR.");
  }

  if (answers != "") {
    try {
      const res = await fetch("https://data.bheitz780.workers.dev/db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: answers, event: thisEvent.key, scouter: scoutID || JSON.parse(localStorage.getItem("userProfile"))?.id || "Unknown" }),
      });
      const result = await res.json();
      console.log(result);
      if (!res.ok || !result.id || result.id.length < 10) return false;
      return result;
    } catch {
      popupError("You seem to be offline. try uploading with QR.");
      return false;
    }
  }
}
