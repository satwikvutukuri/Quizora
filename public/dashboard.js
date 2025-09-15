import { auth, provider, db } from "./firebase.js";
import { signInWithPopup } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  setDoc,
  deleteDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

let user = null;
let quizzes = [];

const loginBtn = document.getElementById("login-btn");
const quizForm = document.getElementById("quiz-form");
const quizList = document.getElementById("quiz-list");
const responsesSection = document.getElementById("responses-section");

// Professor login
loginBtn.onclick = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    user = result.user;
    document.getElementById("profInfo").innerText = `Welcome, ${user.displayName}`;
    loginBtn.style.display = "none";
    quizForm.style.display = "block";
    loadQuizzes();
  } catch (err) {
    alert("Google login failed");
  }
};

// --- DATE LIMIT LOGIC FOR FORM ---

// Dynamically update min for end datetime when start datetime changes
const startInput = document.getElementById("quiz-start");
const endInput = document.getElementById("quiz-end");
if (startInput && endInput) {
  startInput.addEventListener("input", function () {
    endInput.min = this.value;
    // Optional UX: if endInput is before new min, clear it
    if (endInput.value && endInput.value < this.value) {
      endInput.value = "";
    }
  });
  // On form reset, clear min on endInput
  quizForm.addEventListener("reset", function () {
    setTimeout(() => {
      endInput.min = "";
      endInput.value = "";
    }, 10);
  });
}

// --- END DATE LIMIT LOGIC ---

// Create quiz
quizForm.onsubmit = async (e) => {
  e.preventDefault();
  const quizName = quizForm["quiz-name"].value.trim();
  const csvUrl = quizForm["csv-link"].value.trim();
  const allowedEmails = quizForm["allowed-emails"].value.split(",").map(e => e.trim()).filter(e => !!e);

  // Get date and time (if present in form)
  let quizStart = startInput ? startInput.value : null;
  let quizEnd = endInput ? endInput.value : null;

  if (!quizName || !csvUrl || allowedEmails.length === 0) {
    return alert("Fill all fields and provide at least one email");
  }
  if (startInput && endInput && (!quizStart || !quizEnd)) {
    return alert("Please select both start and end date/time.");
  }
  if (quizStart && quizEnd && quizEnd < quizStart) {
    return alert("End Date & Time cannot be before Start Date & Time.");
  }
  await addDoc(collection(db, "quizzes"), {
    owner: user.uid,
    quizName,
    questionsCsvUrl: csvUrl,
    allowedEmails,
    createdAt: new Date(),
    ...(quizStart && { quizStart }),
    ...(quizEnd && { quizEnd })
  });
  alert("Quiz created!");
  quizForm.reset();
  loadQuizzes();
};


async function loadQuizzes() {
  quizList.innerHTML = "Loading quizzes...";
  const qz = query(collection(db, "quizzes"), where("owner", "==", user.uid));
  const snap = await getDocs(qz);
  if (snap.empty) {
    quizList.innerHTML = "<p>No quizzes created yet.</p>";
    return;
  }
  quizzes = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
  const baseUrl = window.location.origin;
  quizList.innerHTML = quizzes.map(q => {
    const quizLink = `${baseUrl}/student.html?quiz=${q.id}`;
    let dateInfo = '';
    if (q.quizStart || q.quizEnd) {
      dateInfo = `<div style="font-size:.98em; color:#94b3d1; margin-bottom:2px;">
        ${q.quizStart ? `Start: <b>${q.quizStart.replace('T',' ')}</b>` : ""}
        ${q.quizEnd ? `<br>End: <b>${q.quizEnd.replace('T',' ')}</b>` : ""}
      </div>`;
    }
    return `<div style="margin-bottom:18px;" data-quiz-row="${q.id}">
      <b>${q.quizName}</b><br>
      ${dateInfo}
      <span style="font-size:0.97em;">Quiz Link: <input type='text' value='${quizLink}' id='link-${q.id}' readonly style='width:60%;font-size:1em;' />
      <button onclick="navigator.clipboard.writeText(document.getElementById('link-${q.id}').value);this.innerText='Copied!';setTimeout(()=>this.innerText='Copy',1200)">Copy</button></span><br>
      <button class="view-responses-btn" data-quizid="${q.id}">View Responses</button>
      <button class="delete-quiz-btn" data-quizid="${q.id}">Delete Quiz</button>
    </div>`;
  }).join("");

  // Attach event listeners for new buttons
  document.querySelectorAll('.view-responses-btn').forEach(btn => {
    btn.onclick = () => showResponsesModal(btn.dataset.quizid);
  });
  document.querySelectorAll('.delete-quiz-btn').forEach(btn => {
    btn.onclick = () => deleteQuizAndResponses(btn.dataset.quizid);
  });
}


// Show responses in modal
async function showResponsesModal(quizId) {
  const modal = document.getElementById('responses-modal');
  const tableBody = document.querySelector('#responses-table tbody');
  tableBody.innerHTML = '<tr><td colspan="3">Loading...</td></tr>';
  modal.style.display = 'flex';

  // Fetch responses
  const respSnap = await getDocs(collection(db, "quizzes", quizId, "responses"));
  tableBody.innerHTML = '';
  if (respSnap.empty) {
    tableBody.innerHTML = '<tr><td colspan="3">No responses yet.</td></tr>';
  } else {
    respSnap.forEach(doc => {
      const d = doc.data();
      tableBody.innerHTML += `<tr>
        <td>${d.email || ''}</td>
        <td>${d.registrationNumber || ''}</td>
        <td>${d.score ?? 'N/A'}</td>
      </tr>`;
    });
  }
}

// Close modal handler
document.getElementById('close-responses-modal').onclick = () => {
  document.getElementById('responses-modal').style.display = 'none';
};

// Batch delete quiz and responses
async function deleteQuizAndResponses(quizId) {
  if (!confirm("Are you sure you want to delete this quiz? This action is irreversible.")) return;
  // Delete all responses in subcollection
  const responsesRef = collection(db, "quizzes", quizId, "responses");
  const responsesSnap = await getDocs(responsesRef);
  const batch = writeBatch(db);
  responsesSnap.forEach(docSnap => {
    batch.delete(doc(db, "quizzes", quizId, "responses", docSnap.id));
  });
  // Delete the quiz document itself
  batch.delete(doc(db, "quizzes", quizId));
  await batch.commit();
  // Remove from UI
  const quizRow = document.querySelector(`[data-quiz-row='${quizId}']`);
  if (quizRow) quizRow.remove();
  alert("Quiz deleted successfully.");
}