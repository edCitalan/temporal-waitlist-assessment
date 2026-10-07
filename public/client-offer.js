const token = location.hash.slice(1);
const feedback = document.querySelector("#client-feedback");
let busy = false;
let current;
const statusCopy = {
  waiting: "This opening is available to you until the deadline. It is reserved only after you accept.",
  "needs-follow-up": "Your question was sent to staff. The appointment is not reserved; your original reply deadline still applies.",
  accepted: "Confirmed in this simulation — this appointment is reserved for you. The salon will handle the calendar update.",
  declined: "You declined this appointment. You do not hold the opening. Thank you for letting us know.",
  expired: "Your reply window has ended. This offer has expired and cannot reserve the appointment.",
  taken: "This appointment was already taken. You do not hold this opening.",
  unavailable: "This opening is no longer available. You do not hold it; please do not travel to the salon for this offer.",
};

async function request(path = "", body) {
  const response = await fetch(`/api/client/offer${path}`, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load this offer. Please try again.");
  return result;
}

function render(offer) {
  current = offer;
  document.querySelector("#client-error").hidden = true;
  document.querySelector("#client-offer").hidden = false;
  document.querySelector("#client-greeting").textContent = `${offer.clientName}, an earlier appointment opened up at Juniper Salon.`;
  document.querySelector("#client-service").textContent = offer.service;
  document.querySelector("#client-stylist").textContent = offer.stylist;
  document.querySelector("#client-time").textContent = offer.displayTime;
  document.querySelector("#client-duration").textContent = `${offer.durationMinutes} minutes`;
  document.querySelector("#client-deadline").textContent = new Intl.DateTimeFormat(undefined, {
    dateStyle: "full", timeStyle: "short", ...(offer.timeZone ? { timeZone: offer.timeZone } : {}),
  }).format(new Date(offer.deadlineAt)) + (offer.timeZone ? ` (${offer.timeZone.replaceAll("_", " ")})` : "");
  const message = statusCopy[offer.status] || statusCopy.unavailable;
  const status = document.querySelector("#client-status");
  if (status.textContent !== message) status.textContent = message;
  status.dataset.status = offer.status;
  document.querySelector("#client-actions").hidden = !offer.canRespond;
  document.querySelectorAll("#client-actions button").forEach(button => { button.disabled = busy || !offer.canRespond; });
}

async function refresh() {
  if (busy) return;
  try { render(await request()); }
  catch (error) {
    const panel = document.querySelector("#client-error");
    panel.textContent = error.message;
    panel.hidden = false;
    document.querySelector("#client-offer").hidden = true;
    document.querySelector("#client-greeting").textContent = "Please use the offer link supplied by Juniper Salon.";
  }
}

async function respond(kind, message) {
  if (busy || !current?.canRespond) return;
  busy = true;
  render(current);
  feedback.textContent = "Sending your response…";
  try {
    const result = await request("/reply", { kind, message });
    feedback.textContent = result.code === "follow-up" ? "Your question was sent. Staff follow-up is needed." : (statusCopy[result.code] || statusCopy.unavailable);
    if (kind === "question") document.querySelector("#client-question").value = "";
    render(await request());
  } catch (error) { feedback.textContent = error.message; }
  finally { busy = false; if (current) render(current); }
}
document.querySelector("#client-accept").addEventListener("click", () => respond("accept"));
document.querySelector("#client-decline").addEventListener("click", () => respond("decline"));
document.querySelector("#client-question-form").addEventListener("submit", event => {
  event.preventDefault();
  const message = document.querySelector("#client-question").value.trim();
  if (message) respond("question", message);
});
if (token) { refresh(); setInterval(refresh, 2000); }
else {
  document.querySelector("#client-greeting").textContent = "Open the personal offer link in the salon's simulated message to see your appointment details.";
}
