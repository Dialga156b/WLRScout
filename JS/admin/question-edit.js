import { questionDB } from "/JS/DB.js";
import { populateQuestions, newEventCache } from "/JS/utils.js";

const tabTemplate = document.getElementById("tab-template");
const newTabBtn = document.getElementById("new-tab-btn");
const tabHeader = document.getElementById("tab-header");
const tabList = document.querySelector(".tablist");
const inputList = document.getElementById("input-list");
const editPanel = document.getElementById("edit-panel");
const closeEditorBtn = document.getElementById("close-editor-btn");
const reopenEditorBtn = document.getElementById("reopen-editor-btn");

const choicePopup = document.getElementById("choice-popup");
const choiceHeader = document.getElementById("choice-header");
const choiceList = choicePopup.querySelector(".c-list");
const choiceBtnTemplate = document.getElementById("choice-btn-template");
const closeCFrameBtn = document.getElementById("close-frame-btn");
const addParamBtn = document.getElementById("add-param-btn");
const addCategoryBtn = document.getElementById("add-category-btn");
const newQuestionBtn = document.getElementById("new-question-btn");

const paramScroll = document.querySelector(".param-scroll");
const paramList = document.getElementById("param-list");
const paramToggleTemplate = document.getElementById("param-toggle-template");
const paramTextTemplate = document.getElementById("param-text-template");
const editHeader = document.querySelector(".edit-header");

const editAdvancedBtn = document.getElementById("edit-advanced-btn");
const editAdvancedTextarea = document.getElementById("edit-advanced");
const shiftUpBtn = document.getElementById("shift-up-btn");
const shiftDownBtn = document.getElementById("shift-down-btn");
const deleteQuestionBtn = document.getElementById("delete-question-btn");
const selectionButtons = [editAdvancedBtn, shiftUpBtn, shiftDownBtn, deleteQuestionBtn];
const reloadPreviewBtn = document.getElementById("reload-preview-btn");
const submitChangesBtn = document.getElementById("submit-changes-btn");
const deleteChangesBtn = document.getElementById("delete-changes-btn");

var eventKey = localStorage.getItem("currentEventKey") || null;

var questionsData = {};
var currentSelectedTabKey = null;
var lastSelectedTabKey = null;

var selectedQuestionID = null;
var lastSelectedQuestionID = null;

const questionParams = await fetch("/config/sample.json").then((res) => res.json());
console.log(questionParams);
function updateSelectionButtons() {
  const hasSelection = !!selectedQuestionID;
  selectionButtons.forEach((btn) => {
    btn.disabled = !hasSelection;
    btn.classList.toggle("needs-selection", !hasSelection);
  });
}

function setEditPanelVisible(visible) {
  editPanel.classList.toggle("panel-hidden", !visible);
  reopenEditorBtn.classList.toggle("hidden", visible);
  if (!visible) {
    reopenEditorBtn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }
}
reopenEditorBtn.classList.toggle("hidden", !editPanel.classList.contains("panel-hidden"));

function setAdvancedMode(show) {
  editPanel.classList.toggle("advanced-mode", show);
  if (show) {
    const question = getSelectedQuestion();
    editAdvancedTextarea.value = question ? JSON.stringify(question, null, 2) : "";
  }
}

function getQuestionElementByID(questionID) {
  if (!questionID) return null;
  const match = Array.from(inputList.children).find((el) => el.querySelector(".form-input").dataset.questionId == questionID);
  return match?.querySelector(".form-input") ?? null;
  // i spent genuinely way too long on this because js sucks
}
async function selectQuestion(questionID) {
  lastSelectedQuestionID = selectedQuestionID;
  selectedQuestionID = questionID;

  const lastQuestionEl = getQuestionElementByID(lastSelectedQuestionID);
  const selectedQuestionEl = getQuestionElementByID(selectedQuestionID);
  if (lastQuestionEl) {
    lastQuestionEl.classList.remove("q-selected");
    lastQuestionEl.parentNode.querySelector("#restart-btn").innerHTML = `<ion-icon name="finger-print"></ion-icon>`;
  }

  if (lastSelectedQuestionID == selectedQuestionID) {
    // person wants to cancel selection of the current question
    selectedQuestionID = null;
    selectedQuestionEl.classList.remove("q-selected");
    setEditPanelVisible(false);
    setAdvancedMode(false);
    updateSelectionButtons();
    return;
  }

  selectedQuestionEl.classList.add("q-selected");

  setEditPanelVisible(true);
  setAdvancedMode(false);
  updateSelectionButtons();
  populateEditPanel();
}

async function selectTab(key) {
  if (currentSelectedTabKey !== null && currentSelectedTabKey !== key) {
    clearQuestionSelection();
  }

  lastSelectedTabKey = currentSelectedTabKey;
  currentSelectedTabKey = key;
  tabHeader.textContent = key.toUpperCase();
  document.getElementById(`tab-${lastSelectedTabKey}`)?.classList.remove("activeTab");
  document.getElementById(`tab-${currentSelectedTabKey}`)?.classList.add("activeTab");

  if (lastSelectedTabKey === null) {
    document.querySelectorAll(".tab-selected").forEach((el) => el.classList.remove("tab-selected"));
    tabList.style = "";
  }
  let cache = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`)) || newEventCache(eventKey);
  const data = cache.questionsData.data;
  const questions = structuredClone(data); // heck yeahhh

  inputList.innerHTML = "";

  await populateQuestions(questions, key, inputList);

  const children = Array.from(inputList.children);
  children.forEach((el, i) => {
    const wrapper = document.createElement("div");
    wrapper.className = "question";

    const qIndex = document.createElement("h3");
    qIndex.textContent = i + 1;

    const wrapper2 = document.createElement("div");
    wrapper2.className = "q-wrapper-right";

    const interactBtn = document.createElement("button");
    interactBtn.id = "restart-btn";
    interactBtn.className = "mini-btn";
    interactBtn.innerHTML = `<ion-icon name="finger-print"></ion-icon>`;

    interactBtn.addEventListener("click", () => {
      interactBtn.innerHTML = `<ion-icon name="checkbox"></ion-icon>`;
      selectQuestion(el.dataset.questionId);
    });

    wrapper2.appendChild(qIndex);
    wrapper2.appendChild(interactBtn);

    inputList.insertBefore(wrapper, el);

    wrapper.appendChild(el);
    wrapper.appendChild(wrapper2);
  });
}

// force selectTab to rerender. poooo!
async function refreshQuestionList(preserveSelection = true) {
  if (!currentSelectedTabKey) return;
  const idToKeep = preserveSelection ? selectedQuestionID : null;
  await selectTab(currentSelectedTabKey);
  if (idToKeep) getQuestionElementByID(idToKeep)?.classList.add("q-selected");
}

function createNewTab(key) {
  const thisTab = tabTemplate.cloneNode(true);
  thisTab.id = `tab-${key}`;
  thisTab.lastChild.textContent = key.toUpperCase();

  thisTab.addEventListener("click", () => {
    selectTab(key);
  });

  tabTemplate.parentNode.appendChild(thisTab);
  tabTemplate.parentNode.appendChild(newTabBtn);
}

// -----
//
// if we're being real, this next segment is claude 😭 it's summer break and
// i have other stuff to worry about. this panel will be seen by like 5 people, so
// functionality is secondary to me atp. even though it looks like it, NO AI WILL EVER
// BE USED FOR THE UI!!!! NO AI DESIGN!!! STUPID!!!! anyways:
//
// -----

function updateQuestionJSON(mutate) {
  const cache = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`) ?? "null");
  const question = cache?.questionsData?.data?.[currentSelectedTabKey]?.find((q) => q.id == selectedQuestionID);
  if (!question) return;
  mutate(question);
  localStorage.setItem(`eventCache_${eventKey}`, JSON.stringify(cache));
}

function setParamValue(category, key, value) {
  updateQuestionJSON((question) => {
    const target = category ? (question[category] ??= {}) : question;
    target[key] = value;
  });
  if (!category && key == "id") selectedQuestionID = value; // keep the selection in sync if the id itself is edited
}

function deleteParam(category, key) {
  updateQuestionJSON((question) => {
    const target = category ? question[category] : question;
    if (target) delete target[key];
  });
}

// template lookup for a question's params, or the params inside one of its categories
function templateScope(question, category = null) {
  const template = questionParams[question?.type] ?? {};
  if (!category) return template;
  return template[category] ?? template[`${category}__R`] ?? {};
}
const isLockedKey = (scope, key) => `${key}__D` in scope; // __D params should never be shown or changed
const isRequiredKey = (scope, key) => `${key}__R` in scope; // __R params break stuff without a value: editable, never removable

function lockRemoveBtn(btn) {
  btn.classList.add("param-lock");
  btn.disabled = true;
  btn.innerHTML = `<ion-icon name="lock-closed"></ion-icon>`;
}

const parseArrayInput = (str) =>
  str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s);

function newParamFromKey(key, value, category = null, container = paramList) {
  let el;
  if (key == "category-override") {
    // false OR a category name string: a checkbox to enable/disable + a text field makes that relationship obvious
    el = paramTextTemplate.cloneNode(true);
    const input = el.querySelector(".param-text-input");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.title = "Override this question's leaderboard category";
    toggle.checked = typeof value == "string";

    input.placeholder = "Category name..";
    input.value = typeof value == "string" ? value : "";
    input.disabled = !toggle.checked;

    toggle.addEventListener("change", () => {
      input.disabled = !toggle.checked;
      if (toggle.checked) {
        input.focus();
        setParamValue(category, key, input.value);
      } else {
        input.value = "";
        setParamValue(category, key, false);
      }
    });
    input.addEventListener("change", () => {
      if (toggle.checked) setParamValue(category, key, input.value);
    });

    el.querySelector(".param-top .param-row").appendChild(toggle);
  } else if (typeof value == "boolean") {
    //checkbox
    el = paramToggleTemplate.cloneNode(true);
    const checkbox = el.querySelector("input[type='checkbox']");
    checkbox.checked = value;
    checkbox.addEventListener("change", () => setParamValue(category, key, checkbox.checked));
  } else {
    //text (also covers numbers and comma-separated arrays)
    el = paramTextTemplate.cloneNode(true);
    const input = el.querySelector(".param-text-input");
    input.value = Array.isArray(value) ? value.join(", ") : value;
    input.addEventListener("change", () => {
      let newValue = input.value;
      if (Array.isArray(value)) newValue = parseArrayInput(input.value);
      else if (typeof value == "number") newValue = Number(input.value) || 0;
      setParamValue(category, key, newValue);
    });
  }
  el.removeAttribute("id");
  el.classList.remove("hidden");
  el.classList.add("param-added");
  el.querySelector(".param-label").textContent = key.toUpperCase();
  const removeBtn = el.querySelector(".mini-btn");
  if (isRequiredKey(templateScope(getSelectedQuestion(), category), key)) {
    lockRemoveBtn(removeBtn);
  } else {
    removeBtn.addEventListener("click", () => {
      deleteParam(category, key);
      el.remove();
    });
  }

  container.insertBefore(el, container.querySelector(":scope > #add-param-btn, :scope > .cat-add-btn"));
}

function newCategorySection(category, value) {
  const section = document.createElement("div");
  section.className = "param-category themed-frosted";
  section.dataset.category = category;

  const top = document.createElement("div");
  top.className = "param-top";
  top.innerHTML = `<div class="param-row"><ion-icon name="${Array.isArray(value) ? "list" : "folder-open"}"></ion-icon><h3 class="param-label"></h3></div>`;
  top.querySelector(".param-label").textContent = category.toUpperCase();

  const removeBtn = document.createElement("button");
  removeBtn.className = "mini-btn";
  removeBtn.style = "height: 30px; width: auto; aspect-ratio: 1;";
  removeBtn.innerHTML = `<ion-icon name="close"></ion-icon>`;
  if (isRequiredKey(templateScope(getSelectedQuestion()), category)) {
    lockRemoveBtn(removeBtn);
  } else {
    removeBtn.addEventListener("click", () => {
      deleteParam(null, category);
      section.remove();
    });
  }
  top.appendChild(removeBtn);
  section.appendChild(top);

  if (Array.isArray(value)) {
    //arrays edit as one comma-separated list
    const input = paramTextTemplate.querySelector(".param-text-input").cloneNode(true);
    input.value = value.join(", ");
    input.addEventListener("change", () => setParamValue(null, category, parseArrayInput(input.value)));
    section.appendChild(input);
  } else {
    const addBtn = document.createElement("button");
    addBtn.className = "mainBtn cat-add-btn";
    addBtn.innerHTML = `<ion-icon name="add-circle"></ion-icon> Add Parameter`;
    addBtn.addEventListener("click", () => showChoicePopup(true, category));
    section.appendChild(addBtn);

    const scope = templateScope(getSelectedQuestion(), category);
    Object.entries(value).forEach(([key, v]) => {
      if (!isLockedKey(scope, key)) newParamFromKey(key, v, category, section);
    });
  }

  paramScroll.appendChild(section);
}

function populateEditPanel() {
  const question = getSelectedQuestion();
  editHeader.textContent = `Edit Question: ${question?.id ?? "?"}`;
  paramList.querySelectorAll(".param-added").forEach((el) => el.remove());
  paramScroll.querySelectorAll(".param-category").forEach((el) => el.remove());
  if (!question) return;

  const scope = templateScope(question);
  Object.entries(question).forEach(([key, value]) => {
    if (isLockedKey(scope, key)) return;
    const templateDefault = scope[key] ?? scope[`${key}__R`];
    if (templateDefault !== null && typeof templateDefault == "object" && (typeof value != "object" || value === null)) {
      // older configs use things like "leaderboard": false — normalize to an empty container
      value = Array.isArray(templateDefault) ? [] : {};
      setParamValue(null, key, value);
    }
    if (typeof value == "object" && value !== null) newCategorySection(key, value);
    else newParamFromKey(key, value);
  });
}

function addParamToQuestion(subject, key, value) {
  if (subject == "category") {
    setParamValue(null, key, value);
    newCategorySection(key, value);
  } else {
    const category = subject == "all" ? null : subject;
    setParamValue(category, key, value);
    const container = category ? paramScroll.querySelector(`.param-category[data-category="${category}"]`) : paramList;
    newParamFromKey(key, value, category, container ?? paramList);
  }
}

newTabBtn.addEventListener("click", () => {
  const res = prompt("New Category's Name:");
  if (!res) return;

  const cache = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`) ?? "null");
  if (!cache?.questionsData?.data) return;

  if (cache.questionsData.data[res]) {
    alert(`Category "${res}" already exists.`);
    return;
  }

  cache.questionsData.data[res] = [];
  localStorage.setItem(`eventCache_${eventKey}`, JSON.stringify(cache));

  createNewTab(res);
});

function getSelectedQuestion() {
  const cache = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`) ?? "null");
  const categoryData = cache?.questionsData?.data?.[currentSelectedTabKey] || [];
  return categoryData.find((q) => q.id == selectedQuestionID) ?? null;
}

function newChoiceBtn(label, onClick) {
  const btn = choiceBtnTemplate.cloneNode(true);
  btn.removeAttribute("id");
  btn.classList.remove("hidden");
  btn.classList.add("choice-btn");
  btn.lastChild.textContent = label.toUpperCase();
  btn.addEventListener("click", onClick);
  choiceList.appendChild(btn);
}

function showChoicePopup(show, subject) {
  choicePopup.classList.toggle("choice-hidden", !show);
  if (!show) return;
  //subject could also be the key of any object or array in the question's json. anything that contains keys itself

  choiceList.querySelectorAll(".choice-btn").forEach((el) => el.remove());

  if (subject == "new") {
    choiceHeader.textContent = "Choose a Question Type..";
    Object.keys(questionParams).forEach((type) => {
      newChoiceBtn(type, () => {
        createNewQuestion(type);
        showChoicePopup(false);
      });
    });
    return;
  }

  const question = getSelectedQuestion();
  const template = questionParams[question?.type];
  if (!template) return;

  const isContainer = (value) => typeof value == "object" && value !== null;

  let entries;
  let existingKeys;
  if (subject == "all" || subject == "category") {
    entries = Object.entries(template).filter(([, value]) => isContainer(value) == (subject == "category"));
    existingKeys = Object.keys(question);
    choiceHeader.textContent = subject == "category" ? "Choose a Category to Add.." : "Choose a Parameter to Add..";
  } else {
    entries = Object.entries(templateScope(question, subject));
    existingKeys = Object.keys(question[subject] ?? {});
    choiceHeader.textContent = `Add to ${subject.toUpperCase()}..`;
  }

  entries.forEach(([templateKey, value]) => {
    if (templateKey.endsWith("__D")) return; // locked params are never shown
    const key = templateKey.replace(/__R$/, ""); // stored questions use the plain key name
    if (existingKeys.includes(key)) return; // only offer what the question doesn't have yet

    newChoiceBtn(key, () => {
      addParamToQuestion(subject, key, structuredClone(value));
      showChoicePopup(false);
    });
  });
}

function createNewQuestion(type) {
  const cache = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`) ?? "null");
  if (!cache?.questionsData?.data?.[currentSelectedTabKey]) return;

  // a new question starts with just the required (__R) and locked (__D) params; the rest get added via the popup
  const question = {};
  Object.entries(questionParams[type]).forEach(([templateKey, value]) => {
    if (templateKey.endsWith("__R") || templateKey.endsWith("__D")) {
      question[templateKey.replace(/__[RD]$/, "")] = structuredClone(value);
    }
  });

  // ids have to be unique for selection and depends to work
  const allIDs = Object.values(cache.questionsData.data)
    .flat()
    .map((q) => q.id);
  let id = question.id;
  for (let n = 2; allIDs.includes(id); n++) id = `${question.id}_${n}`;
  question.id = id;

  cache.questionsData.data[currentSelectedTabKey].push(question);
  localStorage.setItem(`eventCache_${eventKey}`, JSON.stringify(cache));

  selectTab(currentSelectedTabKey).then(() => selectQuestion(id));
}

function shiftSelectedQuestion(offset) {
  if (!selectedQuestionID || !currentSelectedTabKey) return;
  const cache = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`) ?? "null");
  const list = cache?.questionsData?.data?.[currentSelectedTabKey];
  if (!list) return;

  const index = list.findIndex((q) => q.id == selectedQuestionID);
  const newIndex = index + offset;
  if (index === -1 || newIndex < 0 || newIndex >= list.length) return;

  [list[index], list[newIndex]] = [list[newIndex], list[index]];
  localStorage.setItem(`eventCache_${eventKey}`, JSON.stringify(cache));

  refreshQuestionList();
}

function clearQuestionSelection() {
  selectedQuestionID = null;
  lastSelectedQuestionID = null;
  setEditPanelVisible(false);
  setAdvancedMode(false);
  updateSelectionButtons();
}

function deleteSelectedQuestion() {
  if (!selectedQuestionID || !currentSelectedTabKey) return;
  if (!confirm(`Delete question "${selectedQuestionID}"? This can't be undone.`)) return;

  const cache = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`) ?? "null");
  const list = cache?.questionsData?.data?.[currentSelectedTabKey];
  const index = list?.findIndex((q) => q.id == selectedQuestionID) ?? -1;
  if (index === -1) return;

  list.splice(index, 1);
  localStorage.setItem(`eventCache_${eventKey}`, JSON.stringify(cache));

  clearQuestionSelection();
  refreshQuestionList(false);
}

//
// ok, back to me
//

editAdvancedBtn.addEventListener("click", () => {
  setAdvancedMode(!editPanel.classList.contains("advanced-mode"));
});

closeEditorBtn.addEventListener("click", () => {
  setEditPanelVisible(false);
});

reopenEditorBtn.addEventListener("click", () => {
  setEditPanelVisible(true);
});

shiftUpBtn.addEventListener("click", () => shiftSelectedQuestion(-1));
shiftDownBtn.addEventListener("click", () => shiftSelectedQuestion(1));
deleteQuestionBtn.addEventListener("click", deleteSelectedQuestion);

reloadPreviewBtn.addEventListener("click", () => {
  refreshQuestionList();
});

submitChangesBtn.addEventListener("click", async () => {
  const cache = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`) ?? "null");
  const categories = cache?.questionsData?.data;
  if (!categories) return;

  // ipad safari can show confirm() invisibly (but still blocking) if the keyboard is closing at the same time.
  // blur whatever's focused and give the keyboard a moment to go away first
  document.activeElement?.blur();
  await new Promise((resolve) => setTimeout(resolve, 400));

  if (!confirm("Submit these question changes? This updates the live questions for everyone.")) return;

  const btnHTML = submitChangesBtn.innerHTML;
  submitChangesBtn.disabled = true;
  submitChangesBtn.textContent = "Saving...";
  try {
    const result = await questionDB("POST", categories);
    console.log(result);
    alert("Questions saved.");
  } catch (e) {
    console.error("Failed to save questions:", e);
    alert(`Couldn't save questions: ${e.message}`);
  } finally {
    submitChangesBtn.disabled = false;
    submitChangesBtn.innerHTML = btnHTML;
  }
});

deleteChangesBtn.addEventListener("click", async () => {
  if (!confirm("Discard all local changes and reload the last saved questions from the server?")) return;
  if (!confirm("Are you sure? (2/3)")) return;
  if (!confirm("Are you sure? Final warning. (3/3)")) return;
  const data = await questionDB("GET");
  const cache = JSON.parse(localStorage.getItem(`eventCache_${eventKey}`) ?? "null");
  if (!cache) return;
  cache.questionsData = data;
  localStorage.setItem(`eventCache_${eventKey}`, JSON.stringify(cache));

  location.reload();
});

addParamBtn.addEventListener("click", () => {
  showChoicePopup(true, "all"); // all, or a reserve work referring to all bool/str keys that are NOT arrays or objects, and exist as a child of the question object (not IN an array or object, etc.)
});

addCategoryBtn.addEventListener("click", () => {
  showChoicePopup(true, "category");
});

newQuestionBtn.addEventListener("click", () => {
  if (currentSelectedTabKey) showChoicePopup(true, "new");
});

closeCFrameBtn.addEventListener("click", () => {
  showChoicePopup(false);
});

async function init() {
  questionsData = await questionDB("GET");
  const categories = questionsData?.data;
  Object.keys(categories).forEach((key) => {
    createNewTab(key);
  });
}

init();
