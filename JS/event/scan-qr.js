import { retagResponses } from "../utils.js";
import { submitQuestionsOnline } from "../DB.js";
const closeBtn = document.getElementById("close-scan");
const scanBtn = document.getElementById("scanBtn");
const qrPopup = document.getElementById("scan-popup");

const uploadBtn = document.getElementById("upload-scan-btn");
const undobtn = document.getElementById("undo-scan-btn");
const qrNotif = document.getElementById("qr-notification");
const teamCount = document.getElementById("scanned-match-id");

const videoElement = document.getElementById("webcam-feed");

const eventKey = localStorage.getItem("currentEventKey") || null;

let scanning = false;
let stream = null;

let scanIndex = 0;
let scannedData = [];
let lastScannedQR = null;
let alertTimeout = null;

function setPopup(state) {
  if (state) {
    qrPopup.classList.remove("popup-hidden");
    startCamera();
  } else {
    stopCamera();
    qrPopup.classList.add("popup-hidden");
  }
}

function setAlert(state, msg) {
  if (msg) {
    qrNotif.textContent = msg;
  }

  if (state) {
    qrNotif.style.opacity = 1;
  } else {
    qrNotif.style.opacity = 0;
  }
}

// this function is ai generated
async function startCamera() {
  const canvasElement = document.getElementById("qr-canvas");
  const canvas = canvasElement.getContext("2d");

  const constraints = {
    video: {
      facingMode: "environment",
    },
    audio: false,
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = stream;

    await videoElement.play();

    videoElement.classList.add("streaming");
    videoElement.parentElement.classList.add("streaming");

    scanning = true;
    requestAnimationFrame(tick);
  } catch (err) {
    console.error(`Error accessing camera: ${err}`);

    if (err.name === "NotAllowedError") {
      alert("Camera permission denied. Please allow camera access in your browser settings.");
    } else if (err.name === "NotFoundError") {
      alert("No camera found on this device.");
    } else {
      alert("Error accessing camera: " + err.message);
    }
  }

  function tick() {
    if (!scanning) return;

    if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
      canvasElement.height = videoElement.videoHeight;
      canvasElement.width = videoElement.videoWidth;
      canvas.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

      const imageData = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });

      if (code && code.data !== "" && code.data !== " ") {
        //console.log("code detected:", code.data);
        handleQRCode(code.data);
      } else {
        if (lastScannedQR !== null) {
          lastScannedQR = null;
          if (!alertTimeout) {
            setAlert(false);
          }
        }
      }
    }

    requestAnimationFrame(tick);
  }
}

function msgTimeout(msg, time) {
  if (alertTimeout) {
    clearTimeout(alertTimeout);
  }
  setAlert(true, msg);
  alertTimeout = setTimeout(() => {
    setAlert(false);
    alertTimeout = null;
  }, time);
}

function handleQRCode(data) {
  if (data != "" || data != "{}") {
    const parsedData = {
      questions: {
        data: retagResponses(JSON.parse(data).data, JSON.parse(localStorage.getItem(`eventCache_${eventKey}`)).questionsData.data, JSON.parse(data).offlineEnabled !== false, new Set(JSON.parse(data).disabledIds || [])), ///god
        version: JSON.parse(data).version,
      },
      scoutID: JSON.parse(data).scoutID || -1,
    };
    console.log(parsedData);
    const isDuplicate = scannedData.some((item) => {
      if (!item) return false;
      return JSON.stringify(item) === JSON.stringify(parsedData);
    });

    if (lastScannedQR === data) {
      if (isDuplicate && !alertTimeout) {
        setAlert(true, "Already Scanned");
      }
      return;
    }

    lastScannedQR = data;

    if (isDuplicate) {
      if (!alertTimeout) {
        setAlert(true, "Already Scanned");
      }
    } else {
      // new scan
      //console.log(parsedData);

      // TODO make this not have a hardcoded location for team number in the prematch array. maybe add it to the qr code data as its own field or something
      try {
        const teamNumber = parsedData.questions?.data?.prematch?.team || "N/A";
        scannedData.push(parsedData);
        uploadBtn.disabled = false;
        undobtn.disabled = false;

        const thisGraphic = qrPopup.querySelector(`#team${scanIndex + 1}`);
        if (thisGraphic) {
          console.log(parsedData.questions?.data?.prematch?.team);
          thisGraphic.textContent = teamNumber;
          thisGraphic.classList.add("scanned");
        }

        scanIndex += 1;
        teamCount.textContent = `Teams ${scanIndex}/6`;

        msgTimeout(`Scanned Team ${teamNumber}`, 1000);
      } catch (err) {
        console.warn(err);

        msgTimeout(`Err: Malformed QR: ${err.message}`, 1000);
      }
    }
  }
}

function undoPrevious() {
  if (scanIndex <= 0) {
    return;
  }
  if (scanIndex == 1) {
    uploadBtn.disabled = true;
    undobtn.disabled = true;
  }

  scanIndex -= 1;

  teamCount.textContent = `Teams ${scanIndex}/6`;

  scannedData.splice(scanIndex, 1); // instead of setting to null because leaves holes

  const thisGraphic = qrPopup.querySelector(`#team${scanIndex + 1}`);
  thisGraphic.textContent = scanIndex + 1;
  thisGraphic.classList.remove("scanned");

  lastScannedQR = null;

  if (alertTimeout) {
    clearTimeout(alertTimeout);
    alertTimeout = null;
  }
  setAlert(false);
}

function stopCamera() {
  scanning = false;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  videoElement.classList.remove("streaming");
  videoElement.parentElement.classList.remove("streaming");

  lastScannedQR = null;
  if (alertTimeout) {
    clearTimeout(alertTimeout);
    alertTimeout = null;
  }
  setAlert(false);
}

async function uploadThings() {
  if (scannedData.length === 0) {
    msgTimeout("No data to upload", 2000);
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.innerHTML = '<ion-icon name="cloud-upload-outline"></ion-icon> Uploading...';

  const failed = [];
  const succeeded = [];

  for (const data of scannedData) {
    try {
      const teamNumber = data.questions?.data?.prematch?.team || data.scoutID;
      setAlert(true, `Uploading Team ${teamNumber}...`);
      const done = await submitQuestionsOnline(data);
      if (done) {
        console.log("Uploaded data for scoutID:", data.scoutID, "DB ID:", done.id);
        succeeded.push({ ...data, dbId: done.id });
      } else {
        console.warn("Failed to upload data for scoutID:", data.scoutID);
        failed.push(data);
      }
    } catch (err) {
      console.error("Exception uploading scoutID:", data.scoutID, err);
      failed.push(data);
    }
  }

  for (let i = 1; i <= 6; i++) {
    const graphic = qrPopup.querySelector(`#team${i}`);
    if (graphic) {
      graphic.textContent = i;
      graphic.classList.remove("scanned");
    }
  }

  scannedData = failed;
  scanIndex = failed.length;

  failed.forEach((data, i) => {
    const teamNumber = data.questions?.data?.prematch?.team || "N/A";
    const graphic = qrPopup.querySelector(`#team${i + 1}`);
    if (graphic) {
      graphic.textContent = teamNumber;
      graphic.classList.add("scanned");
    }
  });

  teamCount.textContent = `Teams ${scanIndex}/6`;
  lastScannedQR = null;

  uploadBtn.disabled = false;
  uploadBtn.innerHTML = '<ion-icon name="cloud-upload-outline"></ion-icon> Upload to Cloud';

  if (failed.length === 0) {
    const ids = succeeded.map((d) => d.dbId ?? "?").join(", ");
    msgTimeout(`All ${succeeded.length} teams uploaded! (IDs: ${ids})`, 4000);
  } else {
    const failedTeams = failed.map((d) => d.questions?.data?.prematch?.team || d.scoutID).join(", "); //magic
    msgTimeout(`${succeeded.length}/${succeeded.length + failed.length} uploaded. Failed: ${failedTeams}`, 4000);
  }
}

uploadBtn.addEventListener("click", uploadThings);

scanBtn.addEventListener("click", () => setPopup(true));
closeBtn.addEventListener("click", () => setPopup(false));
undobtn.addEventListener("click", undoPrevious);
window.handleQRCode = handleQRCode;
