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
let responsesCache = [];

const loginBtn = document.getElementById("login-btn");
const quizForm = document.getElementById("quiz-form");
const quizList = document.getElementById("quiz-list");

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

// Create quiz (with start/end date and validation)
quizForm.onsubmit = async (e) => {
  e.preventDefault();
  const quizName = quizForm["quiz-name"].value.trim();
  const csvUrl = quizForm["csv-link"].value.trim();
  const allowedEmails = quizForm["allowed-emails"].value.split(",").map(e => e.trim()).filter(e => !!e);
  const startDate = quizForm["quiz-start"].value;
  const endDate = quizForm["quiz-end"].value;

  // Validation for required fields
  if (!quizName || !csvUrl || allowedEmails.length === 0 || !startDate || !endDate) {
    return alert("Fill all fields and provide at least one email and quiz time window.");
  }

  // Validation: endDate must be after startDate
  if (new Date(endDate) <= new Date(startDate)) {
    return alert("End Date & Time must be after Start Date & Time.");
  }

  // Validation: startDate must not be in the past
  const now = new Date();
  if (new Date(startDate) < now) {
    return alert("Start Date & Time cannot be in the past.");
  }

  await addDoc(collection(db, "quizzes"), {
    owner: user.uid,
    quizName,
    questionsCsvUrl: csvUrl,
    allowedEmails,
    startDate,
    endDate,
    createdAt: new Date(),
  });
  alert("Quiz created!");
  quizForm.reset();
  loadQuizzes();
};

function getQuizStatus(start, end) {
  const now = new Date();
  const startDt = new Date(start);
  const endDt = new Date(end);
  if (now < startDt) return "Not Started";
  if (now > endDt) return "Expired";
  return "Active";
}

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
    const status = getQuizStatus(q.startDate, q.endDate);
    let statusColor = "green";
    if (status === "Not Started") statusColor = "#e08f00";
    if (status === "Expired") statusColor = "red";
    return `<div style="margin-bottom:18px;" data-quiz-row="${q.id}">
      <b>${q.quizName}</b> <span style="margin-left:10px; color: ${statusColor};">[${status}]</span><br>
      <span style="font-size:0.97em;">Quiz Link: <input type='text' value='${quizLink}' id='link-${q.id}' readonly style='width:60%;font-size:1em;' />
      <button onclick="navigator.clipboard.writeText(document.getElementById('link-${q.id}').value);this.innerText='Copied!';setTimeout(()=>this.innerText='Copy',1200)">Copy</button></span><br>
      <span style="font-size:0.9em; color:#666;">From: ${new Date(q.startDate).toLocaleString()} To: ${new Date(q.endDate).toLocaleString()}</span><br>
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

// Show responses in modal with filters/search/export
async function showResponsesModal(quizId) {
  const modal = document.getElementById('responses-modal');
  const tableBody = document.querySelector('#responses-table tbody');
  tableBody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
  modal.style.display = 'flex';

  const respSnap = await getDocs(collection(db, "quizzes", quizId, "responses"));
  responsesCache = [];
  respSnap.forEach(doc => {
    const d = doc.data();
    responsesCache.push({
      email: d.email || '',
      registrationNumber: d.registrationNumber || '',
      score: d.score ?? 'N/A',
      status: d.status || '',
      submittedAt: d.attemptedAt
        ? (d.attemptedAt.seconds
            ? new Date(d.attemptedAt.seconds * 1000).toLocaleString()
            : new Date(d.attemptedAt).toLocaleString())
        : ''
    });
  });

  // Render all responses initially
  renderResponsesTable(responsesCache);

  // Export CSV
  document.getElementById('export-csv-btn').onclick = () => {
    exportResponsesToCSV(responsesCache);
  };

  // Filters/search
  document.getElementById('apply-filters').onclick = () => {
    applyFilters();
  };
  document.getElementById('search-box').oninput = () => {
    applyFilters();
  };
}

// Render responses to table
function renderResponsesTable(responses) {
  const tableBody = document.querySelector('#responses-table tbody');
  if (!responses.length) {
    tableBody.innerHTML = '<tr><td colspan="5">No responses yet.</td></tr>';
    return;
  }
  tableBody.innerHTML = responses.map(d => `<tr>
    <td>${d.email}</td>
    <td>${d.registrationNumber}</td>
    <td>${d.score}</td>
    <td>${d.status}</td>
    <td>${d.submittedAt}</td>
  </tr>`).join("");
}

// Export as CSV
function exportResponsesToCSV(responses) {
  if (!responses.length) return alert("No responses to export.");
  const header = ["Email", "Registration Number", "Score", "Status", "Submitted At"];
  const rows = responses.map(d => [
    d.email,
    d.registrationNumber,
    d.score,
    d.status,
    d.submittedAt
  ]);
  const csv = [header, ...rows].map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "quiz_responses.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Filters: status, score range, search
function applyFilters() {
  let filtered = [...responsesCache];
  const status = document.getElementById('status-filter').value;
  const minScore = parseFloat(document.getElementById('min-score').value);
  const maxScore = parseFloat(document.getElementById('max-score').value);
  const search = document.getElementById('search-box').value.toLowerCase();

  if (status) {
    filtered = filtered.filter(r => r.status === status);
  }
  if (!isNaN(minScore)) {
    filtered = filtered.filter(r => Number(r.score) >= minScore);
  }
  if (!isNaN(maxScore)) {
    filtered = filtered.filter(r => Number(r.score) <= maxScore);
  }
  if (search) {
    filtered = filtered.filter(r =>
      r.email.toLowerCase().includes(search) ||
      r.registrationNumber.toLowerCase().includes(search)
    );
  }
  renderResponsesTable(filtered);
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

// Improved UX: set min end time as selected start time
document.addEventListener('DOMContentLoaded', () => {
  const startInput = document.getElementById('quiz-start');
  const endInput = document.getElementById('quiz-end');
  if (startInput && endInput) {
    startInput.addEventListener('change', () => {
      endInput.min = startInput.value;
    });
    endInput.addEventListener('change', () => {
      if (endInput.value < startInput.value) {
        endInput.value = startInput.value;
      }
    });
  }
});